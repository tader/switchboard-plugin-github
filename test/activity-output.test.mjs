import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import setup from '../plugins/github/index.ts';

assert.ok(process.env.SWITCHBOARD_CORE_DIR, 'Set SWITCHBOARD_CORE_DIR to the Switchboard v0.17.0 checkout');
const coreUrl = pathToFileURL(path.resolve(process.env.SWITCHBOARD_CORE_DIR) + path.sep);
const fromCore = (file) => import(new URL(file, coreUrl));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'github-activity-output-'));
const data = path.join(tmp, 'data');
const previews = path.join(tmp, 'previews');
const instance = 'synthetic-github-instance';
Object.assign(process.env, {
  SWITCHBOARD_DATA_DIR: data,
  SWITCHBOARD_ACTIVITY_PREVIEW_ROOT: previews,
  SWITCHBOARD_ACTIVITY_PREVIEW_RESTORE_SAFE: '1',
  SWITCHBOARD_ACTIVITY_PREVIEW_INSTANCE: instance,
  SWITCHBOARD_ACTIVITY_PREVIEW_EPOCH: 'synthetic-epoch',
});
fs.mkdirSync(data);
let db;
after(() => {
  db?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const { initDb, run } = await fromCore('server/db.ts');
const { initKey, encrypt } = await fromCore('server/crypto.ts');
initDb();
initKey();
({ db } = await fromCore('server/db.ts'));

const { openPreviewStore } = await fromCore('shared/activity-preview-store.ts');
const { config } = await fromCore('server/config.ts');
openPreviewStore(previews, [data], instance);
config.previewStoreId = JSON.parse(fs.readFileSync(path.join(previews, 'store.json'), 'utf8')).storeId;
const { initOutputStore, readOutput, setOutputRetention } = await fromCore('server/activity-output.ts');
initOutputStore();
setOutputRetention(4);

const { createUser } = await fromCore('server/users.ts');
const { execute } = await fromCore('server/proxy.ts');
const { plugins } = await fromCore('server/plugins/manager.ts');
const helpers = {
  'api-key': await fromCore('plugins/api-key/index.ts'),
  oauth2: await fromCore('plugins/oauth2/index.ts'),
};
const { services: [service] } = setup({
  settings: { clientId: 'synthetic-app', clientSecret: 'synthetic-app-secret' },
  require: (name) => helpers[name],
});
plugins.services.set(service.id, { service, pluginId: 'github' });

const owner = createUser('synthetic-owner', 'admin');
const caller = { source: 'proxy', tokenId: null, tokenName: null, ip: null, userAgent: null };
const profile = {
  type: 'User',
  login: 'private-login',
  email: 'private@example.test',
  plan: { name: 'private-plan', private_repos: 20 },
};
const profileBody = JSON.stringify(profile);

for (const auth of ['token', 'oauth', 'device']) {
  test(`GitHub activity previews with ${auth}`, async (t) => {
    const secret = `synthetic-${auth}-credential`;
    const credentials = auth === 'token' ? { token: secret } : { accessToken: secret };
    const now = Date.now();
    run('INSERT INTO connections(id,user_id,service_id,method_id,name,config_enc,credentials_enc,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      auth, owner.id, service.id, auth, `Synthetic GitHub ${auth}`, encrypt({}), encrypt(credentials), now, now);

    const cases = [
      { name: 'profile with private fields', preview: { type: 'User' } },
      { name: 'final profile after 401 retry', retry: true, preview: { type: 'User' } },
      { name: 'private fields alone', body: JSON.stringify({ ...profile, type: undefined }) },
      { name: 'credential in selected field', body: JSON.stringify({ ...profile, type: secret }) },
      { name: '32 UTF-8 bytes', body: JSON.stringify({ type: 'é'.repeat(16) }), preview: { type: 'é'.repeat(16) } },
      { name: 'over 32 UTF-8 bytes', body: JSON.stringify({ type: 'é'.repeat(17) }) },
      { name: 'query', url: '/user?page=1' },
      { name: 'different route', url: '/users/example' },
      { name: 'different allowed host', url: 'https://uploads.github.com/user' },
      { name: 'different method', method: 'POST' },
      { name: 'final error', status: 403 },
      { name: 'empty response', status: 204, body: null },
      { name: 'non-JSON', mediaType: 'application/octet-stream' },
      { name: 'malformed JSON', body: '{' },
      { name: 'structured type', body: JSON.stringify({ type: { name: 'User' } }) },
      { name: 'retention disabled', disabled: true },
    ];

    for (const fixture of cases) {
      await t.test(fixture.name, async (subtest) => {
        const { url = '/user', method = 'GET', status = 200, body = profileBody,
          mediaType = 'application/json', preview } = fixture;
        const headers = new Headers({ 'content-type': mediaType, 'x-fixture': 'synthetic' });
        let requests = 0;
        subtest.mock.method(globalThis, 'fetch', async (requestUrl, options) => {
          requests++;
          assert.equal(requestUrl.href, new URL(url, 'https://api.github.com').href);
          assert.equal(options.method, method);
          assert.equal(options.headers.get('authorization'), `Bearer ${secret}`);
          if (fixture.retry && requests === 1) return new Response(null, { status: 401 });
          return new Response(body, { status, headers });
        });
        if (fixture.disabled) {
          setOutputRetention(0);
          subtest.after(() => setOutputRetention(4));
        }

        const { response, auditId, sent } = await execute(owner, auth, { method, url }, undefined, caller);
        assert.equal(requests, fixture.retry ? 2 : 1);
        assert.equal(sent.retried, fixture.retry ?? false);
        assert.equal(response.status, status);
        assert.deepEqual([...response.headers], [...headers]);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(body ?? ''));
        assert.ok(auditId);
        const stored = readOutput(owner.id, auditId, true);
        if (preview) assert.deepEqual(stored.preview, preview);
        else assert.equal(stored.preview, undefined);
      });
    }
  });
}
