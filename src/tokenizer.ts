import { createHash } from "node:crypto";
import { encode as encodeO200k } from "gpt-tokenizer/encoding/o200k_base";
import { encode as encodeCl100k } from "gpt-tokenizer/encoding/cl100k_base";

interface EncodingChoice {
  name: "o200k_base" | "cl100k_base";
  fallback: boolean;
}

const O200K_MODEL = /^(gpt-4o|chatgpt-4o|gpt-5|o[1-9](?:-|$)|codex)/i;
const CL100K_MODEL = /^(gpt-3\.5|gpt-4(?:-|$)|text-embedding-3)/i;

export function chooseEncoding(model?: string): EncodingChoice {
  if (model && O200K_MODEL.test(model)) {
    return { name: "o200k_base", fallback: false };
  }
  if (model && CL100K_MODEL.test(model)) {
    return { name: "cl100k_base", fallback: false };
  }
  return { name: "o200k_base", fallback: true };
}

export class TokenCounter {
  readonly encoding: EncodingChoice["name"];
  readonly fallback: boolean;
  private readonly cache = new Map<string, number>();

  constructor(model?: string, private readonly maxEntries = 2_048) {
    const choice = chooseEncoding(model);
    this.encoding = choice.name;
    this.fallback = choice.fallback;
  }

  count(text: string): number {
    if (!text) return 0;
    const hash = createHash("sha256").update(text).digest("hex");
    const cached = this.cache.get(hash);
    if (cached !== undefined) {
      this.cache.delete(hash);
      this.cache.set(hash, cached);
      return cached;
    }
    const tokens =
      this.encoding === "cl100k_base"
        ? encodeCl100k(text).length
        : encodeO200k(text).length;
    this.cache.set(hash, tokens);
    if (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest) this.cache.delete(oldest);
    }
    return tokens;
  }
}
