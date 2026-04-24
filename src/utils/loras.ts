export interface ILoraData {
  name: string;
  multiplier: number;
  is_high_noise?: boolean;
}

/**
 * Extracts LoRA information from a prompt.
 * @param prompt The input prompt string.
 * @returns An array containing the modified prompt and the extracted LoRA data.
 */
export function extractLorasFromPrompt(prompt: string): [string, ILoraData[]] {
  const loraData: ILoraData[] = [];
  const pattern = /<lora:([^:>]+):([^>]+)>/g;

  const updatedPrompt = prompt.replace(pattern, (match, rawPath, rawMul) => {
    if (rawMul.trim() === "") {
      return "";
    }
    const mul = Number(rawMul);

    if (isNaN(mul)) {
      return "";
    }

    let path = rawPath;
    let isHighNoise = false;
    const prefix = "|high_noise|";
    if (path.startsWith(prefix)) {
      path = path.substring(prefix.length);
      isHighNoise = true;
    }

    loraData.push({
      name: path,
      multiplier: mul,
      ...(isHighNoise ? { is_high_noise: true } : {}),
    });

    return "";
  });

  return [updatedPrompt, loraData];
}
