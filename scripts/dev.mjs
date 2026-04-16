import { spawn } from "node:child_process";

const children = [
  spawn("node", ["esbuild.config.mjs", "--watch"], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false
  }),
  spawn("npx", ["partykit", "dev"], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32"
  })
];

function shutdown(signal = "SIGTERM") {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown();
      process.exit(code);
    }
  });
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
  process.exit(0);
});
