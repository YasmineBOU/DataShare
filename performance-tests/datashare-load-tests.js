/**
 * DataShare - k6 Load Tests
 *
 * Rotation automatique des fichiers par VU (sans video3) :
 *   VU 1 → image1 (9 MB), VU 2 → image2 (59 MB), VU 3 → pdf (219 KB),
 *   VU 4 → video1 (18 MB), VU 5 → word (3 KB), VU 6 → image1, ...
 *
 * Pour tester video3 séparément :
 *   k6 run --env FILE=video3 --env SCENARIO=smoke datashare-load-tests.js
 *
 * Choisir un scénario :
 *   k6 run --env SCENARIO=smoke  datashare-load-tests.js
 *   k6 run --env SCENARIO=load   datashare-load-tests.js
 *   k6 run --env SCENARIO=stress datashare-load-tests.js
 *   k6 run --env SCENARIO=spike  datashare-load-tests.js
 *   k6 run                        datashare-load-tests.js   # tous les scénarios
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { FormData } from 'https://jslib.k6.io/formdata/0.0.2/index.js';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/latest/dist/bundle.js';
import tempo from 'https://jslib.k6.io/http-instrumentation-tempo/1.0.0/index.js';
import pyroscope from 'https://jslib.k6.io/http-instrumentation-pyroscope/1.0.1/index.js';

// ─────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────
const BASE_URL       = 'https://localhost:8443';
const COOKIE_NAME    = 'authToken';
const SECRETS        = JSON.parse(open('./secrets.json'));
const TEST_USER      = { email: SECRETS.email, password: SECRETS.password };
const DELAY          = 0.7;
const FILE_ROOT_PATH = 'D:\\Formations\\Autres\\Formation\\ExpertDevops\\Projets\\Projet_3\\Rendus\\performance-tests\\data\\';

// Catalogue complet (video3 disponible via --env FILE=video3 uniquement)
const FILE_CATALOG = {
  image1: { filename: 'image_test_1_9MB.jpg',   fileType: 'image/jpeg',       fileSize: 9924866,   fileHash: '1b7a6cbba4bf074add606bfd90d7605bc2f00f1806ce1ad790f61fd57198da47' },
  image2: { filename: 'image_test_2_59MB.png',  fileType: 'image/png',        fileSize: 60651641,  fileHash: 'ce04086527db34f77ea3036a4f3b0620c4a3a5b3f5a50abe43749dc3e09807da' },
  pdf:    { filename: 'pdf_test_1_219KB.pdf',   fileType: 'application/pdf',  fileSize: 224028,    fileHash: 'ca6694edaf05f7807ad7e341d8cf759d87044636c2d1804b0e8106fff04872fa' },
  video1: { filename: 'video_test_1_18MB.mp4',  fileType: 'video/mp4',        fileSize: 18776852,  fileHash: 'f28a1f09f525e11f2d524578cae6635080888778fd23a120adac4130e51f572a'  },
  video3: { filename: 'video_test_3_158MB.mp4', fileType: 'video/mp4',        fileSize: 162130197, fileHash: 'a13a40860a35e9f988aaf5b25d23eb7a2bab3e691fb8af779379618575fa7b3f' },
  word:   { filename: 'word_test_1_3KB.odt',    fileType: 'application/vnd.oasis.opendocument.text', fileSize: 2360, fileHash: 'dbd663e5eba0bbbe348791c4bb2c0859c947af7b0c89b079247a81671940bf77' },
};

// ─────────────────────────────────────────
// SÉLECTION DU FICHIER
// Mode --env FILE=video3 : un seul fichier (pas de rotation)
// Mode normal            : rotation sur les 5 petits fichiers
// ─────────────────────────────────────────
const SINGLE_FILE_KEY = (__ENV.FILE && FILE_CATALOG[__ENV.FILE]) ? __ENV.FILE : null;

// Fichiers de rotation : tout sauf video3
const ROTATION_META = Object.entries(FILE_CATALOG)
  .filter(([key]) => key !== 'video3')
  .map(([key, meta]) => ({ key, ...meta }));

if (SINGLE_FILE_KEY) {
  // Mode fichier unique : enregistrer seulement ce fichier dans l'allowlist
  if (__VU === 0) {
    open(`${FILE_ROOT_PATH}${FILE_CATALOG[SINGLE_FILE_KEY].filename}`, 'b');
  }
} else {
  // Mode rotation : enregistrer les 5 fichiers dans l'allowlist (__VU==0)
  // Mémoire parse phase : ~86 Mo (9+59+0,2+18+0,003), libéré ensuite
  if (__VU === 0) {
    for (const meta of ROTATION_META) {
      open(`${FILE_ROOT_PATH}${meta.filename}`, 'b');
    }
  }
}

// Chaque VU charge uniquement son fichier assigné
const _myMeta = SINGLE_FILE_KEY
  ? { key: SINGLE_FILE_KEY, ...FILE_CATALOG[SINGLE_FILE_KEY] }
  : ROTATION_META[__VU > 0 ? (__VU - 1) % ROTATION_META.length : 0];
const MY_FILE = { ..._myMeta, content: open(`${FILE_ROOT_PATH}${_myMeta.filename}`, 'b') };

const FILE_PASSWORD = '', EXPIRATION_DAYS = 1;

// ─────────────────────────────────────────
// MÉTRIQUES PERSONNALISÉES
// ─────────────────────────────────────────
const loginDuration     = new Trend('login_duration',       true);
const authMeDuration    = new Trend('req_auth_me_duration',     true);
const uploadDuration    = new Trend('req_upload_duration',      true);
const listFilesDuration = new Trend('req_list_files_duration',  true);
const fileInfoDuration  = new Trend('req_file_info_duration',   true);
const fileLinkDuration  = new Trend('req_file_link_duration',   true);
const downloadDuration  = new Trend('req_download_duration',    true);
const deleteDuration    = new Trend('req_delete_file_duration', true);
const errorRate         = new Rate('error_rate');
const uploadCount       = new Counter('total_uploads');

// ─────────────────────────────────────────
// OPTIONS / SCÉNARIOS
// ─────────────────────────────────────────
const ALL_SCENARIOS = {
  smoke:  { 
    executor: 'constant-vus', 
    vus: 1, 
    duration: '30s', 
    tags: 
      { scenario: 'smoke' } 
  },
  load:   { 
    executor: 'ramping-vus', 
    startVUs: 1, 
    stages: [
      { duration: '30s', target: 10 }, 
      { duration: '1m', target: 10 }, 
      { duration: '30s', target: 0 }
    ], 
    tags: { scenario: 'load' } 
  },
  stress: { executor: 'ramping-vus', startVUs: 1, stages: [{ duration: '20s', target: 10 }, { duration: '1m', target: 20 }, { duration: '20s', target: 40 }, { duration: '40s', target: 40 }, { duration: '20s', target: 0 }], tags: { scenario: 'stress' } },
  // stress: { 
  //   executor: 'ramping-vus', 
  //   startVUs: 1, 
  //   stages: [
  //     { duration: '30s', target: 5 }, 
  //     { duration: '1m', target: 15 }, 
  //     { duration: '30s', target: 30 }, 
  //     { duration: '1m', target: 30 }, 
  //     { duration: '30s', target: 0 }
  //   ], 
  //   tags: { scenario: 'stress' } 
  // },
  spike:  { 
    executor: 'ramping-vus', 
    startVUs: 1, 
    stages: [
      { duration: '10s', target: 2  }, 
      { duration: '5s',  target: 50 }, 
      { duration: '30s', target: 50 }, 
      { duration: '10s', target: 0 }
    ], 
    tags: { scenario: 'spike'  } 
  },
};

const _s = __ENV.SCENARIO;
// export const options = {
//   scenarios: (_s && ALL_SCENARIOS[_s]) ? { [_s]: ALL_SCENARIOS[_s] } : ALL_SCENARIOS,
//   thresholds: {
//     'http_req_duration{name:login}':         ['p(95)<1000'],
//     'http_req_duration{name:auth_me}':       ['p(95)<500'],
//     'http_req_duration{name:list_files}':    ['p(95)<2000'],
//     'http_req_duration{name:file_info}':     ['p(95)<1000'],
//     'http_req_duration{name:file_link}':     ['p(95)<1000'],
//     'http_req_duration{name:delete_file}':   ['p(95)<1000'],
//     'http_req_duration{name:logout}':        ['p(95)<500'],
//     'http_req_duration{name:upload}':        ['p(95)<30000'],
//     // req_upload_duration:                          ['p(95)<30000'],
//     'http_req_duration{name:download_blob}': ['p(95)<60000'],
//     // req_download_duration:                        ['p(95)<60000'],
//     http_req_failed:                          ['rate<0.05'],
//     error_rate:                               ['rate<0.05'],
//   },
//   insecureSkipTLSVerify: true,
// };


export const options = {
  scenarios: (_s && ALL_SCENARIOS[_s]) ? { [_s]: ALL_SCENARIOS[_s] } : ALL_SCENARIOS,
  thresholds: {
    login_duration:             ['p(95)<4000'],
    req_auth_me_duration:       ['p(95)<4000'],
    req_list_files_duration:    ['p(95)<2000'],
    req_file_info_duration:     ['p(95)<2000'],
    req_file_link_duration:     ['p(95)<2000'],
    req_delete_file_duration:   ['p(95)<2000'],
    req_upload_duration:        ['p(95)<7000'],
    req_download_duration:      ['p(95)<7000'],

    http_req_failed:            ['rate<0.05'],
    error_rate:                 ['rate<0.05'],
  },
  insecureSkipTLSVerify: true,
};

tempo.instrumentHTTP({ propagator: 'w3c' });
pyroscope.instrumentHTTP();

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────
function makeHeaders(cookie = null) {
  const h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (cookie) h['Cookie'] = `${COOKIE_NAME}=${cookie}`;
  return h;
}

function login(email = TEST_USER.email, password = TEST_USER.password) {
  const res = http.post(`${BASE_URL}/api/login`,
    JSON.stringify({ email, password }),
    { headers: makeHeaders(), tags: { name: 'login' } });
  loginDuration.add(res.timings.duration);
  errorRate.add(res.status !== 200);
  check(res, {
    'login: status 200':  (r) => r.status === 200,
    'login: has message': (r) => r.json('message') !== undefined,
  });
  const match = (res.headers['Set-Cookie'] || '').match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

function logout(authCookie) {
  const res = http.post(`${BASE_URL}/api/logout`, null,
    { headers: makeHeaders(authCookie), tags: { name: 'logout' } });
  check(res, { 'logout: status 200': (r) => r.status === 200 });
}

// ─────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────
export function setup() {
  if (SINGLE_FILE_KEY) {
    console.log(`Mode fichier unique : [${SINGLE_FILE_KEY}] ${MY_FILE.filename} — ${Math.round(MY_FILE.fileSize / 1024 / 1024)} MB par VU`);
  } else {
    console.log(`Mode rotation : ${ROTATION_META.map(m => m.key).join(', ')} (${ROTATION_META.length} fichiers)`);
  }
}

// ─────────────────────────────────────────
// SCÉNARIO PRINCIPAL
// ─────────────────────────────────────────
export default function () {
  const f = MY_FILE; // fichier assigné à ce VU
  let authCookie = null, uploadedFileToken = null, uploadedFileId = null;

  group('1. Authentication', () => {
    group('Login',    () => { authCookie = login(); });
    sleep(DELAY);
    group('Auth Me',  () => {
      const res = http.get(`${BASE_URL}/api/auth/me`,
        { headers: makeHeaders(authCookie), tags: { name: 'auth_me' } });
      authMeDuration.add(res.timings.duration);
      errorRate.add(res.status !== 200);
      check(res, {
        'auth/me: status 200':        (r) => r.status === 200,
        'auth/me: authenticated true': (r) => r.json('authenticated') === true,
        'auth/me: has email':          (r) => r.json('email') !== null,
      });
    });
  });

  if (!authCookie) { console.error('Login failed'); return; }
  sleep(DELAY);

  group('2. File Upload', () => {
    const fd = new FormData();
    fd.append('file',           http.file(f.content, f.filename, f.fileType));
    fd.append('filename',       f.filename);
    fd.append('fileSize',       f.fileSize.toString());
    fd.append('fileType',       f.fileType);
    fd.append('hash',           f.fileHash);
    fd.append('expirationDays', EXPIRATION_DAYS.toString());
    if (TEST_USER.email) fd.append('email',        TEST_USER.email);
    if (FILE_PASSWORD)   fd.append('filePassword', FILE_PASSWORD);

    const res = http.post(`${BASE_URL}/api/files/upload`, fd.body(), {
      headers: { ...makeHeaders(authCookie), 'Content-Type': `multipart/form-data; boundary=${fd.boundary}` },
      tags: { name: 'upload' }, timeout: '300s',
    });
    uploadDuration.add(res.timings.duration);
    errorRate.add(res.status !== 200);
    uploadCount.add(1);
    check(res, {
      'upload: status 200':    (r) => r.status === 200,
      'upload: has fileToken': (r) => r.json('fileToken') !== undefined,
    });
    if (res.status === 200) uploadedFileToken = res.json('fileToken');
    else console.error(`Upload failed [${res.status}]: ${res.body}`);
  });
  sleep(DELAY);

  group('3. File Listing', () => {
    const res = http.get(
      `${BASE_URL}/api/files/list?email=${encodeURIComponent(TEST_USER.email)}`,
      { headers: makeHeaders(authCookie), tags: { name: 'list_files' } });
    listFilesDuration.add(res.timings.duration);
    errorRate.add(res.status !== 200);
    check(res, {
      'list files: status 200': (r) => r.status === 200,
      'list files: has files':  (r) => Array.isArray(r.json('files')),
    });
    if (res.status === 200 && uploadedFileToken) {
      const found = res.json('files').find((x) => x.fileToken === uploadedFileToken);
      if (found) uploadedFileId = found.id;
    }
  });
  sleep(DELAY);

  if (uploadedFileToken) {
    group('4. File Info', () => {
      const res = http.get(
        `${BASE_URL}/api/files/info?fileToken=${uploadedFileToken}`,
        { headers: makeHeaders(authCookie), tags: { name: 'file_info' } });
      fileInfoDuration.add(res.timings.duration);
      errorRate.add(res.status !== 200);
      check(res, {
        'file info: status 200':    (r) => r.status === 200,
        'file info: has filename':  (r) => r.json('filename') !== undefined,
      });
    });
    sleep(DELAY);

    group('5. Get Download Link', () => {
      const res = http.post(`${BASE_URL}/api/files/download`,
        JSON.stringify({ id: uploadedFileId, filePassword: FILE_PASSWORD }),
        { headers: makeHeaders(authCookie), tags: { name: 'file_link' } });
      fileLinkDuration.add(res.timings.duration);
      errorRate.add(![200, 401].includes(res.status));
      check(res, {
        'file link: status 200':    (r) => r.status === 200,
        'file link: has fileLink':  (r) => r.json('fileLink') !== undefined,
      });
      if (res.status === 200 && res.json('fileLink')) {
        group('6. Download Blob', () => {
          const dlRes = http.get(res.json('fileLink'), {
            responseType: 'binary', tags: { name: 'download_blob' }, timeout: '300s',
          });
          downloadDuration.add(dlRes.timings.duration);
          errorRate.add(dlRes.status !== 200);
          check(dlRes, {
            'download: status 200':    (r) => r.status === 200,
            'download: has content':   (r) => r.body.byteLength > 0,
          });
        });
      }
    });
  }
  sleep(DELAY);

  if (uploadedFileId) {
    group('7. Delete File', () => {
      const res = http.del(
        `${BASE_URL}/api/files/delete/${uploadedFileId}`, null,
        { headers: makeHeaders(authCookie), tags: { name: 'delete_file' } });
      deleteDuration.add(res.timings.duration);
      errorRate.add(res.status !== 200);
      check(res, { 'delete: status 200': (r) => r.status === 200 });
    });
  }
  sleep(DELAY);

  group('8. Logout', () => { logout(authCookie); });
  sleep(randomIntBetween(1, 3));
}

// ─────────────────────────────────────────
// RAPPORT
// ─────────────────────────────────────────
export function handleSummary(data) {
  return {
    [`k6-results/summary_${_s}.html`]: htmlReport(data),
    [`k6-results/summary_${_s}.json`]: JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const { metrics } = data;
  const fileInfo = SINGLE_FILE_KEY
    ? `[${SINGLE_FILE_KEY}] ${MY_FILE.filename}`
    : `rotation: ${ROTATION_META.map(m => m.key).join(', ')}`;
  const lines = ['\n=== DataShare Load Test Summary ===\n', `  Fichiers : ${fileInfo}\n`];
  for (const n of ['login_duration','req_auth_me_duration','req_list_files_duration','req_file_info_duration','req_file_link_duration','delete_duration']) {
    const m = metrics[n]; if (!m) continue;
    lines.push(`  ${n.padEnd(25)} avg=${m.values['avg']?.toFixed(0)||'N/A'}ms  p95=${m.values['p(95)']?.toFixed(0)||'N/A'}ms`);
  }
  lines.push('');
  for (const n of ['req_upload_duration','req_download_duration']) {
    const m = metrics[n]; if (!m) continue;
    lines.push(`  ${n.padEnd(25)} avg=${m.values['avg']?.toFixed(0)||'N/A'}ms  p95=${m.values['p(95)']?.toFixed(0)||'N/A'}ms  ← fichiers lourds`);
  }
  lines.push('');
  const e = metrics['error_rate'];   if (e) lines.push(`  error_rate:               ${(e.values.rate * 100).toFixed(2)}%`);
  const u = metrics['total_uploads']; if (u) lines.push(`  total_uploads:            ${u.values.count}`);
  return lines.join('\n') + '\n';
}