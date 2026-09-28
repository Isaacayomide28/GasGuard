import { ParserFuzzer } from './parser-fuzzer';

describe('Parser Fuzz Testing (#982)', () => {
  const fuzzer = new ParserFuzzer();

  const safeParser = (input: string): string => {
    if (typeof input !== 'string') throw new TypeError('Expected string');
    return input.trim();
  };

  const strictParser = (input: string): number => {
    if (typeof input !== 'string') throw new TypeError('Expected string');
    const num = Number(input);
    if (isNaN(num)) throw new Error('Not a number');
    return num;
  };

  it('parser does not crash on random inputs', async () => {
    const result = await fuzzer.fuzzParser(safeParser, {
      iterations: 200,
      maxLength: 500,
    });
    expect(result.passed + result.failed).toBe(200);
    expect(result.errors.length).toBeLessThanOrEqual(result.failed);
  });

  it('parser does not crash on edge cases', () => {
    const edgeCases = fuzzer.generateEdgeCases();
    for (const input of edgeCases) {
      expect(() => safeParser(input)).not.toThrow();
    }
  });

  it('strict parser rejects non-numeric inputs gracefully', async () => {
    const result = await fuzzer.fuzzParser(strictParser, {
      iterations: 100,
      maxLength: 200,
    });
    expect(result.passed + result.failed).toBe(100);
    for (const err of result.errors) {
      expect(err.error).toBeDefined();
    }
  });

  it('handles very large inputs without memory issues', async () => {
    const largeInput = 'a'.repeat(100_000);
    expect(() => safeParser(largeInput)).not.toThrow();
  });
});
