import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  Adjudication,
  Agreement,
  Delivery,
  Dispute,
  LedgerEvent,
  Order,
  Payment,
  Settlement,
  Verification,
} from "../../domain/model";
import type { AgentBinding, RecourseStore } from "../../domain/ports";

/**
 * File-backed store.
 *
 * Entities are keyed exactly as the Postgres schema in `schema.sql` keys them,
 * so swapping this for a real database is a driver change, not a redesign.
 * Writes are atomic (write-temp + rename) and every order has a mutex so that
 * concurrent settlement attempts serialise instead of racing.
 */

interface Snapshot {
  sequence: number;
  agents: Record<string, AgentBinding>;
  orders: Record<string, Order>;
  agreements: Record<string, Agreement>;
  payments: Record<string, Payment>;
  paymentReferences: Record<string, string>;
  deliveries: Record<string, Delivery>;
  verifications: Record<string, Verification>;
  disputes: Record<string, Dispute>;
  adjudications: Record<string, Adjudication>;
  settlements: Record<string, Settlement>;
  events: Record<string, LedgerEvent[]>;
}

function emptySnapshot(): Snapshot {
  return {
    sequence: 0,
    agents: {},
    orders: {},
    agreements: {},
    payments: {},
    paymentReferences: {},
    deliveries: {},
    verifications: {},
    disputes: {},
    adjudications: {},
    settlements: {},
    events: {},
  };
}

export class JsonStore implements RecourseStore {
  private readonly file: string;
  private snapshot: Snapshot = emptySnapshot();
  private loaded = false;
  /** Modification time of the ledger as of the last read or write. */
  private lastMtimeMs = 0;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(file: string) {
    this.file = file;
  }

  /* ------------------------------------------------------------ internals */

  /**
   * Loads the ledger, and reloads it if another process has written since.
   *
   * `npm run seed` runs in a separate process from the dev server. Without this
   * check the server would keep serving a stale in-memory snapshot and a judge
   * would see a ledger that does not match the one on disk.
   */
  private async load(): Promise<void> {
    let mtimeMs = 0;
    try {
      mtimeMs = (await stat(this.file)).mtimeMs;
    } catch {
      mtimeMs = 0;
    }

    if (this.loaded && mtimeMs === this.lastMtimeMs) return;

    try {
      const raw = await readFile(this.file, "utf-8");
      this.snapshot = { ...emptySnapshot(), ...(JSON.parse(raw) as Snapshot) };
    } catch {
      this.snapshot = emptySnapshot();
    }
    this.lastMtimeMs = mtimeMs;
    this.loaded = true;
  }

  private persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(this.snapshot, null, 2), "utf-8");
      await rename(tmp, this.file);
      try {
        this.lastMtimeMs = (await stat(this.file)).mtimeMs;
      } catch {
        /* the next read will simply reload */
      }
    });
    return this.writeChain;
  }

  /** Test/seed hook: replace everything in one shot. */
  async reset(next?: Partial<Snapshot>): Promise<void> {
    this.snapshot = { ...emptySnapshot(), ...next };
    this.loaded = true;
    await this.persist();
  }

  async withOrderLock<T>(orderId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(orderId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(
      orderId,
      previous.then(() => gate),
    );
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(orderId) === gate) this.locks.delete(orderId);
    }
  }

  /* --------------------------------------------------------------- orders */

  async nextOrderSequence(): Promise<number> {
    await this.load();
    this.snapshot.sequence += 1;
    await this.persist();
    return this.snapshot.sequence;
  }

  /* --------------------------------------------------------------- agents */

  async getAgentBinding(handle: string): Promise<AgentBinding | null> {
    await this.load();
    return this.snapshot.agents[handle] ?? null;
  }

  async putAgentBinding(binding: AgentBinding): Promise<void> {
    await this.load();
    this.snapshot.agents[binding.handle] = {
      ...binding,
      address: binding.address.toLowerCase(),
    };
    await this.persist();
  }

  async listAgentBindings(): Promise<AgentBinding[]> {
    await this.load();
    return Object.values(this.snapshot.agents).sort((a, b) => a.handle.localeCompare(b.handle));
  }

  /* --------------------------------------------------------------- orders */

  async putOrder(order: Order): Promise<void> {
    await this.load();
    this.snapshot.orders[order.id] = order;
    await this.persist();
  }

  async getOrder(orderId: string): Promise<Order | null> {
    await this.load();
    return this.snapshot.orders[orderId] ?? null;
  }

  async listOrders(): Promise<Order[]> {
    await this.load();
    return Object.values(this.snapshot.orders).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  /* ----------------------------------------------------------- agreements */

  async putAgreement(agreement: Agreement): Promise<void> {
    await this.load();
    this.snapshot.agreements[agreement.orderId] = agreement;
    await this.persist();
  }

  async getAgreement(orderId: string): Promise<Agreement | null> {
    await this.load();
    return this.snapshot.agreements[orderId] ?? null;
  }

  /* ------------------------------------------------------------- payments */

  async putPayment(payment: Payment): Promise<void> {
    await this.load();
    this.snapshot.payments[payment.orderId] = payment;
    this.snapshot.paymentReferences[payment.reference] = payment.orderId;
    await this.persist();
  }

  async getPayment(orderId: string): Promise<Payment | null> {
    await this.load();
    return this.snapshot.payments[orderId] ?? null;
  }

  async hasPaymentReference(reference: string): Promise<boolean> {
    await this.load();
    return reference in this.snapshot.paymentReferences;
  }

  /* ----------------------------------------------------------- deliveries */

  async putDelivery(delivery: Delivery): Promise<void> {
    await this.load();
    this.snapshot.deliveries[delivery.orderId] = delivery;
    await this.persist();
  }

  async getDelivery(orderId: string): Promise<Delivery | null> {
    await this.load();
    return this.snapshot.deliveries[orderId] ?? null;
  }

  /* -------------------------------------------------------- verifications */

  async putVerification(verification: Verification): Promise<void> {
    await this.load();
    this.snapshot.verifications[verification.orderId] = verification;
    await this.persist();
  }

  async getVerification(orderId: string): Promise<Verification | null> {
    await this.load();
    return this.snapshot.verifications[orderId] ?? null;
  }

  /* ------------------------------------------------------------- disputes */

  async putDispute(dispute: Dispute): Promise<void> {
    await this.load();
    this.snapshot.disputes[dispute.id] = dispute;
    await this.persist();
  }

  async getDispute(disputeId: string): Promise<Dispute | null> {
    await this.load();
    return this.snapshot.disputes[disputeId] ?? null;
  }

  async getDisputeByOrder(orderId: string): Promise<Dispute | null> {
    await this.load();
    return (
      Object.values(this.snapshot.disputes).find((dispute) => dispute.orderId === orderId) ?? null
    );
  }

  async listDisputes(): Promise<Dispute[]> {
    await this.load();
    return Object.values(this.snapshot.disputes).sort((a, b) =>
      b.openedAt.localeCompare(a.openedAt),
    );
  }

  /* --------------------------------------------------------- adjudications */

  async putAdjudication(adjudication: Adjudication): Promise<void> {
    await this.load();
    this.snapshot.adjudications[adjudication.disputeId] = adjudication;
    await this.persist();
  }

  async getAdjudication(disputeId: string): Promise<Adjudication | null> {
    await this.load();
    return this.snapshot.adjudications[disputeId] ?? null;
  }

  async getAdjudicationByOrder(orderId: string): Promise<Adjudication | null> {
    await this.load();
    return (
      Object.values(this.snapshot.adjudications).find((item) => item.orderId === orderId) ?? null
    );
  }

  /* ---------------------------------------------------------- settlements */

  async putSettlement(settlement: Settlement): Promise<void> {
    await this.load();
    this.snapshot.settlements[settlement.orderId] = settlement;
    await this.persist();
  }

  async getSettlement(orderId: string): Promise<Settlement | null> {
    await this.load();
    return this.snapshot.settlements[orderId] ?? null;
  }

  /* --------------------------------------------------------------- events */

  async appendEvent(event: LedgerEvent): Promise<void> {
    await this.load();
    const existing = this.snapshot.events[event.orderId] ?? [];
    existing.push(event);
    this.snapshot.events[event.orderId] = existing;
    await this.persist();
  }

  async listEvents(orderId: string): Promise<LedgerEvent[]> {
    await this.load();
    return [...(this.snapshot.events[orderId] ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  }
}

export const DEFAULT_STORE_FILE = join(process.cwd(), ".recourse", "ledger.json");
