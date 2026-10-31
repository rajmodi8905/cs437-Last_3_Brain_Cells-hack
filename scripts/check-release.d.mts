export function verifyRelease(
  directory: string,
  basePath: string,
  expectedManifestPath?: string,
): Promise<{
  basePath: string;
  files: number;
  totalBytes: number;
  largestFile: string;
  largestBytes: number;
  assetManifestSha256: string;
  artifactSha256: string;
  note: string;
}>;
