/// <reference types="node" />
// ObjectStore on Azure Blob Storage. On Azure the server signs in with the VM's managed
// identity, so no storage key is ever configured; locally it talks to Azurite.
import { BlobServiceClient, RestError, type ContainerClient } from '@azure/storage-blob';
import type { ObjectStore } from './store';

/** The shape Azure's SDK accepts as a token credential. */
export interface TokenCredential {
  getToken(
    scopes: string | string[],
  ): Promise<{ token: string; expiresOnTimestamp: number } | null>;
}

const IMDS = 'http://169.254.169.254/metadata/identity/oauth2/token';

/**
 * A Blob Storage token from the Azure VM's managed identity (the instance metadata service),
 * cached until five minutes before it expires. `clientId` picks a user-assigned identity.
 */
export function managedIdentityCredential(
  options: { clientId?: string; fetch?: typeof fetch; now?: () => number } = {},
): TokenCredential {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresOnTimestamp: number } | undefined;
  return {
    async getToken() {
      if (cached && cached.expiresOnTimestamp - now() > 5 * 60_000) return cached;
      const url = new URL(IMDS);
      url.searchParams.set('api-version', '2018-02-01');
      url.searchParams.set('resource', 'https://storage.azure.com/');
      if (options.clientId) url.searchParams.set('client_id', options.clientId);
      const res = await fetchImpl(url, { headers: { Metadata: 'true' } });
      if (!res.ok) throw new Error(`Managed identity token request failed: HTTP ${res.status}`);
      const body = (await res.json()) as { access_token?: string; expires_on?: string };
      if (!body.access_token || !body.expires_on)
        throw new Error('Managed identity token response is incomplete.');
      cached = { token: body.access_token, expiresOnTimestamp: Number(body.expires_on) * 1000 };
      return cached;
    },
  };
}

const isNotFound = (cause: unknown) => cause instanceof RestError && cause.statusCode === 404;
/** Block IDs must all have the same length. */
const blockId = (index: number) => Buffer.from(String(index).padStart(8, '0')).toString('base64');

export class AzureBlobObjectStore implements ObjectStore {
  private constructor(private container: ContainerClient) {}

  /**
   * With `connectionString` (local development and tests, such as Azurite) or with `accountUrl`
   * and a token credential (Azure). Creates the private container when it is missing.
   */
  static async open(
    options:
      | { connectionString: string; container: string }
      | { accountUrl: string; container: string; credential: TokenCredential },
  ) {
    const service =
      'connectionString' in options
        ? BlobServiceClient.fromConnectionString(options.connectionString)
        : new BlobServiceClient(options.accountUrl, options.credential);
    const container = service.getContainerClient(options.container);
    // No public access level: blobs are reachable only through this server.
    await container.createIfNotExists();
    return new AzureBlobObjectStore(container);
  }

  async put(key: string, bytes: Uint8Array) {
    await this.container.getBlockBlobClient(key).uploadData(bytes);
  }

  async get(key: string, range?: { start: number; end: number }) {
    try {
      const buffer = await this.container
        .getBlobClient(key)
        .downloadToBuffer(range?.start ?? 0, range ? range.end - range.start + 1 : undefined);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch (cause) {
      if (isNotFound(cause)) return undefined;
      throw cause;
    }
  }

  async delete(key: string) {
    await this.container.getBlobClient(key).deleteIfExists();
  }

  async compose(target: string, parts: string[]) {
    const blob = this.container.getBlockBlobClient(target);
    const ids: string[] = [];
    for (const [index, key] of parts.entries()) {
      const part = await this.get(key);
      if (!part) throw new Error(`Missing part ${key}`);
      const id = blockId(index);
      await blob.stageBlock(id, part, part.length);
      ids.push(id);
    }
    await blob.commitBlockList(ids);
  }

  /** Tests only: removes the container and everything in it. */
  async deleteContainerForTests() {
    await this.container.deleteIfExists();
  }
}
