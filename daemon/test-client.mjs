#!/usr/bin/env node
/**
 * Minimal claudes-codexd protocol client for end-to-end testing.
 *
 *   node daemon/test-client.mjs --url ws://127.0.0.1:8423 \
 *     [--provider claude] [--model haiku] [--prompt "Reply with exactly: CLAUDES-CODEX-OK"]
 */

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
const url = args.url ?? 'ws://127.0.0.1:8423';
const provider = args.provider ?? 'claude';
const model = args.model ?? 'haiku';
const prompt = args.prompt ?? 'Reply with exactly: CLAUDES-CODEX-OK';
if (!url) {
  console.error('usage: test-client.mjs --url ws://host:port [--provider claude] [--model haiku] [--prompt ...]');
  process.exit(2);
}

const ws = new WebSocket(url);
let rpcId = 0;
const pending = new Map();
let runtimeId = null;
let accumulated = '';
let sawEnd = false;

const deadline = setTimeout(() => {
  console.error('\nFAIL: timed out after 180s');
  process.exit(1);
}, 180_000);

function send(msg) {
  ws.send(JSON.stringify(msg));
}

function rpc(method, params) {
  const id = ++rpcId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ t: 'rpc', id, method, params });
  });
}

ws.onopen = () => {
  send({ t: 'hello', proto: 1, clientId: 'test-client', clientInfo: 'daemon/test-client' });
};

ws.onmessage = async (event) => {
  const msg = JSON.parse(String(event.data));
  switch (msg.t) {
    case 'hello.ok': {
      console.log(`hello.ok: daemon ${msg.daemonVersion}, vault "${msg.vaultName}", providers: ${msg.providers.join(', ')}`);
      try {
        const created = await rpc('runtime.create', { providerId: provider });
        runtimeId = created.runtimeId;
        console.log(`runtime created: ${runtimeId} (ready=${created.state.isReady})`);
        await rpc('runtime.query', {
          runtimeId,
          request: { text: prompt },
          options: { model },
        });
        console.log(`query accepted (model=${model}); streaming:`);
      } catch (err) {
        console.error('FAIL:', err.message ?? err);
        process.exit(1);
      }
      break;
    }
    case 'hello.err':
      console.error('FAIL: hello rejected:', msg.error);
      process.exit(1);
      break;
    case 'rpc.ok': {
      pending.get(msg.id)?.resolve(msg.result);
      pending.delete(msg.id);
      break;
    }
    case 'rpc.err': {
      pending.get(msg.id)?.reject(new Error(msg.error));
      pending.delete(msg.id);
      break;
    }
    case 'q.ev': {
      const ev = msg.ev;
      if (ev.k === 'prepared') {
        console.log(`  [prepared] persistedContent=${JSON.stringify(ev.prepared.persistedContent).slice(0, 80)}`);
      } else if (ev.k === 'chunk') {
        if (ev.chunk.type === 'text') {
          accumulated += ev.chunk.content;
          process.stdout.write(ev.chunk.content);
        } else if (ev.chunk.type === 'error') {
          console.error(`\n  [chunk:error] ${ev.chunk.content}`);
        } else {
          console.log(`  [chunk:${ev.chunk.type}]`);
        }
      } else if (ev.k === 'state') {
        console.log(`\n  [state] sessionId=${ev.state.sessionId} ready=${ev.state.isReady}`);
      } else if (ev.k === 'end') {
        sawEnd = true;
        console.log('  [end]');
        await rpc('runtime.dispose', { runtimeId }).catch(() => {});
        clearTimeout(deadline);
        const trimmed = accumulated.trim();
        if (trimmed.length > 0) {
          console.log(`\nPASS: streamed ${trimmed.length} chars${trimmed.includes('CLAUDES-CODEX-OK') ? ' (marker found)' : ''}`);
          process.exit(0);
        } else {
          console.error('\nFAIL: stream ended with no text');
          process.exit(1);
        }
      } else if (ev.k === 'err') {
        console.error(`\nFAIL: query error: ${ev.error}`);
        process.exit(1);
      }
      break;
    }
    case 'cb': {
      // Auto-approve anything the daemon asks (text-only prompts shouldn't trigger this).
      console.log(`  [cb:${msg.kind}] auto-responding`);
      const result = msg.kind === 'approval' ? 'allow' : null;
      send({ t: 'cb.res', cbId: msg.cbId, result });
      break;
    }
    case 'ev':
      console.log(`  [ev:${msg.kind}] ${JSON.stringify(msg.payload).slice(0, 100)}`);
      break;
  }
};

ws.onclose = () => {
  if (!sawEnd) {
    console.error('FAIL: connection closed before end');
    process.exit(1);
  }
};
ws.onerror = () => {
  console.error('FAIL: websocket error (is the daemon running?)');
  process.exit(1);
};
