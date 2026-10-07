import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/createTestApp.js';

describe('ApiServer lifecycle', () => {
  it('listens and closes cleanly when idle', async () => {
    const { container } = await createTestApp();
    const server = await container.server.listen(0);
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);
    await expect(container.server.close(1000)).resolves.toBeUndefined();
    expect(server.listening).toBe(false);
  });

  it('rejects when an in-flight request outlives the shutdown timeout', async () => {
    const { container } = await createTestApp();
    const server = await container.server.listen(0);
    const { port } = server.address() as AddressInfo;
    // A request whose headers never finish keeps the connection active (not idle).
    const socket = connect(port, '127.0.0.1');
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write('GET /api/health HTTP/1.1\r\nHost: localhost\r\n');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(container.server.close(100)).rejects.toThrow(/timed out/);
    socket.destroy();
  });
});
