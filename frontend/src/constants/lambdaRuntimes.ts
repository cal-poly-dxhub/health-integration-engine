export interface RuntimeOption {
  value: string;
  label: string;
}

export const LAMBDA_RUNTIMES: RuntimeOption[] = [
  { value: 'nodejs20.x', label: 'Node.js 20.x' },
  { value: 'nodejs18.x', label: 'Node.js 18.x' },
  { value: 'python3.13', label: 'Python 3.13' },
  { value: 'python3.12', label: 'Python 3.12' },
  { value: 'python3.11', label: 'Python 3.11' },
  { value: 'python3.10', label: 'Python 3.10' },
  { value: 'python3.9', label: 'Python 3.9' },
  { value: 'java17', label: 'Java 17' },
  { value: 'java11', label: 'Java 11' },
  { value: 'dotnet8', label: 'C# (.NET 8)' },
  { value: 'dotnet6', label: 'C# (.NET 6)' },
];

export const LAMBDA_RUNTIME_VALUES = LAMBDA_RUNTIMES.map(r => r.value);

export const LAMBDA_ARCHITECTURES = ['x86_64', 'arm64'] as const;
export type LambdaArchitecture = typeof LAMBDA_ARCHITECTURES[number];

export const DEFAULT_LAMBDA_RUNTIME = 'python3.12';
export const DEFAULT_LAMBDA_ARCHITECTURE: LambdaArchitecture = 'x86_64';

export const MAX_LAMBDA_LAYERS = 5;
export const MAX_LAYER_ZIP_BYTES = 50 * 1024 * 1024;
