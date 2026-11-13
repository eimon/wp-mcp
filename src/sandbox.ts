/**
 * Runs model-written JavaScript in a fresh QuickJS (WASM) context — the
 * self-hosted equivalent of Cloudflare's "Code Mode" isolates. The sandbox has
 * no fetch, no filesystem, no process and no env: the only way out is the
 * host functions passed in `bindings`, which run here in Node with the real
 * WordPress credentials. The generated code never sees them.
 *
 * Each call gets its own WASM module instance (a few ms), so nothing leaks
 * between executions — not even a QuickJS abort, which kills its module.
 */
import {
  newQuickJSWASMModule,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSHandle,
} from "quickjs-emscripten";

export type HostBinding = (args: unknown) => Promise<unknown>;

export interface SandboxLimits {
  timeoutMs: number;
  memoryBytes: number;
  maxHostCalls: number;
}

export interface SandboxResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  logs: string[];
  hostCalls: number;
}

/**
 * `prelude` runs before the user code and builds the friendly API (e.g. the
 * `wp` object) on top of the low-level `__host(name, json)` function.
 */
export async function runInSandbox(
  code: string,
  prelude: string,
  bindings: Record<string, HostBinding>,
  limits: SandboxLimits,
): Promise<SandboxResult> {
  const QuickJS = await newQuickJSWASMModule();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(1024 * 1024);
  const deadline = Date.now() + limits.timeoutMs;
  // Only fires while JS is running; time spent awaiting host calls is covered
  // by the wall-clock race below.
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
  const vm = runtime.newContext();

  const logs: string[] = [];
  let hostCalls = 0;
  let disposed = false;

  try {
    const logFn = vm.newFunction("__log", (lineHandle) => {
      if (logs.length < 200) logs.push(vm.getString(lineHandle));
    });
    vm.setProp(vm.global, "__log", logFn);
    logFn.dispose();

    const hostFn = vm.newFunction("__host", (nameHandle, argsHandle) => {
      const name = vm.getString(nameHandle);
      const rawArgs = vm.getString(argsHandle);
      const deferred = vm.newPromise();

      const settle = (fn: () => void) => {
        if (disposed) return;
        fn();
        deferred.dispose();
        runtime.executePendingJobs();
      };

      hostCalls += 1;
      const binding = Object.prototype.hasOwnProperty.call(bindings, name) ? bindings[name] : undefined;
      const call: Promise<unknown> =
        hostCalls > limits.maxHostCalls
          ? Promise.reject(new Error(`Host call limit reached (${limits.maxHostCalls} per execution).`))
          : binding
            ? Promise.resolve().then(() => binding(JSON.parse(rawArgs)))
            : Promise.reject(new Error(`Unknown host function: ${name}`));

      call.then(
        (value) =>
          settle(() => {
            const handle = vm.newString(JSON.stringify(value ?? null));
            deferred.resolve(handle);
            handle.dispose();
          }),
        (error: unknown) =>
          settle(() => {
            const handle = vm.newError(error instanceof Error ? error.message : String(error));
            deferred.reject(handle);
            handle.dispose();
          }),
      );
      return deferred.handle;
    });
    vm.setProp(vm.global, "__host", hostFn);
    hostFn.dispose();

    vm.unwrapResult(vm.evalCode(prelude, "prelude.js")).dispose();

    const wrapped = `(async () => {\n${code}\n})()`;
    const evalResult = vm.evalCode(wrapped, "agent.js");
    if (evalResult.error) {
      return { ok: false, error: formatError(vm, evalResult.error), logs, hostCalls };
    }

    const promiseHandle: QuickJSHandle = evalResult.value;
    // resolvePromise() attaches a `then` inside the VM; pending jobs must run
    // afterwards or an already-settled promise never reports back.
    const resolved = vm.resolvePromise(promiseHandle);
    runtime.executePendingJobs();

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Execution timed out after ${limits.timeoutMs} ms.`)),
        Math.max(0, deadline - Date.now()),
      );
    });

    try {
      const settled = await Promise.race([resolved, timeout]);
      promiseHandle.dispose();
      if (settled.error) {
        return { ok: false, error: formatError(vm, settled.error), logs, hostCalls };
      }
      const value = vm.dump(settled.value);
      settled.value.dispose();
      return { ok: true, result: value, logs, hostCalls };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), logs, hostCalls };
  } finally {
    disposed = true;
    try {
      vm.dispose();
      runtime.dispose();
    } catch {
      // A timed-out execution can leave handles alive (pending promises) and
      // QuickJS aborts its module on dispose. That module is this call's
      // alone, so let the GC take it.
    }
  }
}

function formatError(vm: QuickJSContext, handle: QuickJSHandle): string {
  const dumped = vm.dump(handle);
  handle.dispose();
  if (dumped && typeof dumped === "object") {
    const { name, message, stack } = dumped as { name?: string; message?: string; stack?: string };
    return [`${name ?? "Error"}: ${message ?? ""}`, stack].filter(Boolean).join("\n");
  }
  return String(dumped);
}
