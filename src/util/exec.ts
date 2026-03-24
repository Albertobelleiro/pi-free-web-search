import { execFile } from "node:child_process";

export function execFileText(command: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve((stdout || "").trim());
    });
  });
}
