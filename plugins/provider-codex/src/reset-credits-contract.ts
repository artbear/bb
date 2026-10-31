import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { resetCreditsSchema } from "./usage-contract.js";

export const codexResetCreditsHostContract = defineRpcContract({
  "codex.usage.resetCredits": {
    input: z.object({}).strict(),
    output: resetCreditsSchema,
  },
});
