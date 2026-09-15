import { createWalletClient, custom, type Chain, type Hex, type WalletClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/**
 * An EIP-1193 provider backed by a local private key.
 *
 * The Transaction Kit is the recommended way to submit a GenLayer write: it
 * quotes a fee distribution and its fee value from a measured profile plus live
 * network prices, submits that quote unchanged, and reports a fee-config hash a
 * reviewer can compare. Every integration path in the docs assumes a browser
 * wallet, because that is where user-facing apps sign.
 *
 * Recourse's buyer and seller are *agents*, not people: the protocol submits
 * adjudications from a server-held key. So instead of a wallet extension this
 * module presents the kit with the same interface it expects — an EIP-1193
 * `request({ method, params })` — implemented over a deployment key:
 *
 *   - `eth_sendTransaction` / `eth_signTransaction` are signed locally with the
 *     key and broadcast as a raw transaction. The key never leaves the process
 *     and is never handed to a remote signer.
 *   - `eth_accounts`, `eth_chainId` and the signing methods answer locally.
 *   - Everything else (reads, receipts, estimates) is proxied to the node
 *     verbatim, so the provider cannot silently disagree with the network about
 *     state.
 *
 * This is a transport adapter, not a policy layer: it does not decide fees and
 * it cannot fabricate a receipt. That is deliberate — the fee decision belongs
 * to the kit's quote, and the receipt belongs to the node.
 */

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

export interface SigningProviderOptions {
  privateKey: `0x${string}`;
  chain: Chain;
  rpcUrl: string;
}

export interface SigningProviderResult {
  provider: Eip1193Provider;
  address: `0x${string}`;
}

export function createSigningProvider({
  privateKey,
  chain,
  rpcUrl,
}: SigningProviderOptions): SigningProviderResult {
  const account: PrivateKeyAccount = privateKeyToAccount(privateKey);
  /*
   * The wallet signs through this provider rather than beside it, so the chain
   * identity viem asserts before signing is the one answered here — not a
   * second round trip that could disagree with the key that is about to sign.
   */
  let wallet: WalletClient | null = null;
  const signingWallet = (): WalletClient => {
    if (!wallet) throw new Error("Signing provider used before its wallet client was ready");
    return wallet;
  };

  const rpc = async (method: string, params: unknown[]): Promise<unknown> => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });
    if (!response.ok) {
      throw new Error(`${method} failed: HTTP ${response.status} from ${rpcUrl}`);
    }
    const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) {
      throw new Error(`${method} failed: ${body.error.message ?? "unknown node error"}`);
    }
    return body.result;
  };

  const asArray = (params: unknown[] | object | undefined): unknown[] => {
    if (params === undefined) return [];
    return Array.isArray(params) ? params : [params];
  };

  /**
   * A wallet-shaped request, translated into what the key can sign.
   *
   * `from` is dropped on purpose: the identity is the key we hold, so a caller
   * cannot ask the node to sign as somebody else. Fee fields are passed through
   * when the caller set them, so the node's quote is what gets signed rather
   * than a second estimate invented here.
   */
  const prepare = (raw: unknown): Record<string, unknown> => {
    const tx = (raw ?? {}) as Record<string, unknown>;
    const big = (value: unknown): bigint | undefined =>
      value === undefined || value === null ? undefined : BigInt(value as string);

    const prepared: Record<string, unknown> = {
      to: tx.to as Hex | undefined,
      data: tx.data as Hex | undefined,
      value: big(tx.value),
      gas: big(tx.gas),
      nonce: tx.nonce === undefined ? undefined : Number(tx.nonce as string),
      gasPrice: big(tx.gasPrice),
      maxFeePerGas: big(tx.maxFeePerGas),
      maxPriorityFeePerGas: big(tx.maxPriorityFeePerGas),
    };
    return Object.fromEntries(Object.entries(prepared).filter(([, v]) => v !== undefined));
  };

  const provider: Eip1193Provider = {
    async request({ method, params }) {
      const args = asArray(params);

      switch (method) {
        case "eth_accounts":
        case "eth_requestAccounts":
          return [account.address];

        case "eth_chainId":
          return `0x${chain.id.toString(16)}`;

        case "eth_sendTransaction": {
          const prepared = prepare(args[0]);
          const hash = await signingWallet().sendTransaction({ account, chain, ...prepared });
          return hash;
        }

        case "eth_signTransaction": {
          const prepared = prepare(args[0]);
          return signingWallet().signTransaction({ account, chain, ...prepared });
        }

        case "personal_sign": {
          const [data] = args as [string, string];
          return account.signMessage({ message: { raw: data as Hex } });
        }

        case "eth_signTypedData_v4": {
          const [, json] = args as [string, string];
          const typed = JSON.parse(json) as {
            domain: Record<string, unknown>;
            types: Record<string, unknown>;
            primaryType: string;
            message: Record<string, unknown>;
          };
          delete (typed.types as Record<string, unknown>).EIP712Domain;
          return account.signTypedData(
            typed as Parameters<PrivateKeyAccount["signTypedData"]>[0],
          );
        }

        default:
          // Reads and receipts are the node's answer, never ours.
          return rpc(method, args);
      }
    },
  };

  wallet = createWalletClient({ account, chain, transport: custom(provider) });

  return { provider, address: account.address };
}
