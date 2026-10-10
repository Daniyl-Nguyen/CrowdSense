// Placeholder until M4; index.ts falls back to LocalRepo if this throws.
export class NeonRepo {
  constructor(_url: string) {}
  async init(): Promise<never> {
    throw new Error('Neon repo not implemented yet');
  }
}
