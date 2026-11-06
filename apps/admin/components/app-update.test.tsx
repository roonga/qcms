import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppUpdate } from "./app-update.tsx";
import { t } from "../lib/i18n/en.ts";
import { SERVICE_WORKER_PATH, SKIP_WAITING } from "../lib/pwa/service-worker.ts";

type Listener = () => void;

class FakeWorker {
  readonly postMessage = vi.fn();
  state = "installing";
  private readonly listeners: Listener[] = [];

  addEventListener(_: string, listener: Listener): void {
    this.listeners.push(listener);
  }

  removeEventListener(): void {}

  install(): void {
    this.state = "installed";
    for (const listener of this.listeners) listener();
  }
}

class FakeRegistration {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  private readonly listeners: Listener[] = [];

  addEventListener(_: string, listener: Listener): void {
    this.listeners.push(listener);
  }

  removeEventListener(): void {}

  updateFound(worker: FakeWorker): void {
    this.installing = worker;
    for (const listener of this.listeners) listener();
  }
}

function container(options: {
  readonly controlled: boolean;
  readonly registration: FakeRegistration;
}) {
  return {
    controller: options.controlled ? {} : null,
    register: vi.fn(() => Promise.resolve(options.registration)),
  };
}

function withContainer(value: unknown): void {
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "serviceWorker");
  vi.restoreAllMocks();
});

const notice = () => screen.queryByTestId("qcms-app-update");

describe("the update notice", () => {
  it("registers the worker at the root with the HTTP cache bypassed", async () => {
    const registration = new FakeRegistration();
    const sw = container({ controlled: true, registration });
    withContainer(sw);

    render(<AppUpdate />);

    await waitFor(() => {
      expect(sw.register).toHaveBeenCalledWith(SERVICE_WORKER_PATH, {
        scope: "/",
        updateViaCache: "none",
      });
    });
  });

  it("stays silent where the browser runs no worker at all", () => {
    render(<AppUpdate />);

    expect(notice()).toBeNull();
  });

  it("offers the reload once a replacement is waiting", async () => {
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker();
    withContainer(container({ controlled: true, registration }));

    render(<AppUpdate />);

    await waitFor(() => {
      expect(notice()).not.toBeNull();
    });
    expect(screen.getByRole("status").textContent).toContain(t("appUpdate.available"));
  });

  it("says nothing on a first install, which replaces no running version", async () => {
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker();
    const sw = container({ controlled: false, registration });
    withContainer(sw);

    render(<AppUpdate />);

    await waitFor(() => {
      expect(sw.register).toHaveBeenCalled();
    });
    expect(notice()).toBeNull();
  });

  it("appears when a worker installs while the page is open", async () => {
    const registration = new FakeRegistration();
    const sw = container({ controlled: true, registration });
    withContainer(sw);

    render(<AppUpdate />);
    await waitFor(() => {
      expect(sw.register).toHaveBeenCalled();
    });
    expect(notice()).toBeNull();

    const next = new FakeWorker();
    registration.updateFound(next);
    next.install();

    await waitFor(() => {
      expect(notice()).not.toBeNull();
    });
  });

  it("hands the waiting worker its permission to take over, on the press and not before", async () => {
    const registration = new FakeRegistration();
    const waiting = new FakeWorker();
    registration.waiting = waiting;
    withContainer(container({ controlled: true, registration }));

    render(<AppUpdate />);
    await waitFor(() => {
      expect(notice()).not.toBeNull();
    });
    expect(waiting.postMessage).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: t("appUpdate.reload") }));

    expect(waiting.postMessage).toHaveBeenCalledWith(SKIP_WAITING);
  });
});
