export interface SseHub {
  subscribe(): ReadableStream<Uint8Array>;
  broadcast(message: unknown): void;
  close(): void;
  clientCount(): number;
}

type Controller = ReadableStreamDefaultController<Uint8Array>;

const encoder = new TextEncoder();

function unref(timer: ReturnType<typeof setInterval>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}

export function createSseHub(heartbeatMs: number): SseHub {
  const clients = new Map<Controller, ReturnType<typeof setInterval>>();

  function remove(controller: Controller): void {
    const timer = clients.get(controller);
    if (timer) clearInterval(timer);
    clients.delete(controller);
  }

  return {
    subscribe(): ReadableStream<Uint8Array> {
      let controllerRef: Controller | null = null;

      return new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
          clients.set(
            controller,
            (() => {
              const timer = setInterval(() => {
                try {
                  controller.enqueue(encoder.encode(": ping\n\n"));
                } catch {
                  remove(controller);
                }
              }, heartbeatMs);
              unref(timer);
              return timer;
            })()
          );

          controller.enqueue(encoder.encode(": connected\n\n"));
        },
        cancel() {
          if (controllerRef) {
            remove(controllerRef);
            controllerRef = null;
          }
        },
      });
    },

    broadcast(message: unknown): void {
      const frame = encoder.encode(`data: ${JSON.stringify(message)}\n\n`);
      for (const controller of Array.from(clients.keys())) {
        try {
          controller.enqueue(frame);
        } catch {
          remove(controller);
        }
      }
    },

    close(): void {
      for (const [controller, timer] of clients) {
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
      clients.clear();
    },

    clientCount(): number {
      return clients.size;
    },
  };
}
