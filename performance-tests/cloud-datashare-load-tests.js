import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import encoding from 'k6/encoding';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import tempo from 'https://jslib.k6.io/http-instrumentation-tempo/1.0.0/index.js';
import pyroscope from 'https://jslib.k6.io/http-instrumentation-pyroscope/1.0.1/index.js';
import secrets from 'k6/secrets';

// ─────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────

const BASE_URL        = 'https://foster-ferret-wafer.ngrok-free.dev';
const COOKIE_NAME     = 'authToken';
const FILE_URL        = 'https://filebin.net/hkaoqluxuiirfuso/cypress_coverage.jpg';
const FILE_HASH       = '502f542d01b5509cb6c6b2eee14ab6a32d138af6d9ba2181b30ae9396b14c0f1';
const FILE_PASSWORD   = '';
const EXPIRATION_DAYS = 1;
const ENABLE_SSL      = true;
const SLEEP_TIME      = ENABLE_SSL ? 0.8 : 0.5;

// ─────────────────────────────────────────
// OPTIONS
// ─────────────────────────────────────────

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus', vus: 1, duration: '30s',
      startTime: '0s', exec: 'run', tags: { scenario: 'smoke' },
    },
    load: {
      executor: 'ramping-vus', startVUs: 1,
      stages: [{ duration: '30s', target: 10 }, { duration: '1m', target: 10 }, { duration: '30s', target: 0 }],
      startTime: '30s', exec: 'run', tags: { scenario: 'load' },
    },
    stress: {
      executor: 'ramping-vus', startVUs: 1,
      stages: [{ duration: '30s', target: 10 }, { duration: '1m', target: 25 }, { duration: '30s', target: 40 }, { duration: '1m', target: 40 }, { duration: '30s', target: 0 }],
      startTime: '2m30s', exec: 'run', tags: { scenario: 'stress' },
    },
    spike: {
      executor: 'ramping-vus', startVUs: 1,
      stages: [{ duration: '10s', target: 2 }, { duration: '5s', target: 40 }, { duration: '30s', target: 40 }, { duration: '10s', target: 0 }],
      startTime: '6m', exec: 'run', tags: { scenario: 'spike' },
    },
  },
  thresholds: {
    http_req_failed:     ['rate<0.05'],
    http_req_duration:   ['p(95)<3000'],
    login_duration:      ['p(95)<1500'],
    list_files_duration: ['p(95)<2000'],
    upload_duration:     ['p(95)<3000'],
    download_duration:   ['p(95)<1500'],
    auth_me_duration:    ['p(95)<1000'],
    file_info_duration:  ['p(95)<1500'],
    file_link_duration:  ['p(95)<2000'],
    delete_duration:     ['p(95)<1500'],
    error_rate:          ['rate<0.05'],
  },
};

// ─────────────────────────────────────────
// CUSTOM METRICS
// ─────────────────────────────────────────

const loginDuration     = new Trend('login_duration',      true);
const authMeDuration    = new Trend('auth_me_duration',    true);
const uploadDuration    = new Trend('upload_duration',     true);
const listFilesDuration = new Trend('list_files_duration', true);
const fileInfoDuration  = new Trend('file_info_duration',  true);
const fileLinkDuration  = new Trend('file_link_duration',  true);
const downloadDuration  = new Trend('download_duration',   true);
const deleteDuration    = new Trend('delete_duration',     true);
const errorRate         = new Rate('error_rate');

// ─────────────────────────────────────────
// INSTRUMENTATION
// ─────────────────────────────────────────

tempo.instrumentHTTP({ propagator: 'w3c' });

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

function makeHeaders(cookie = null) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (cookie) h['Cookie'] = `${COOKIE_NAME}=${cookie}`;
  return h;
}

function logFail(label, res) {
  console.error(
    `[VU ${__VU} iter ${__ITER}] ${label} FAILED — ` +
    `status=${res.status} body=${String(res.body).substring(0, 300)}`
  );
}

function login(email, password) {
  const res = http.post(
    `${BASE_URL}/api/login`,
    JSON.stringify({ email, password }),
    { headers: makeHeaders(), tags: { name: 'login' } }
  );
  loginDuration.add(res.timings.duration);
  errorRate.add(res.status !== 200);

  check(res, {
    'login: status 200':  (r) => r.status === 200,
    'login: has message': (r) => r.json('message') !== undefined,
  });

  // Extract authToken cookie from Set-Cookie header
  const setCookieHeader = res.headers['Set-Cookie'] || '';
  const match = setCookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (! match){
    console.error(
      `[VU ${__VU} iter ${__ITER}] Login 200 OK but cookie '${COOKIE_NAME}' ` +
      `not found in Set-Cookie: "${setCookieHeader.substring(0, 200)}"`
    );
  }
    
  return match ? match[1] : null;
}

// ─────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────

export async function setup() {
  // Get secrets from Testing & synthetics → Performance → Settings → Secrets
  const [email, password] = await Promise.all([
    secrets.get('datashare-test-user-email'),
    secrets.get('datashare-test-user-password'),
  ]);
  // Get file 
  const fileRes = http.get(FILE_URL, { responseType: 'binary' });
  if (!fileRes || fileRes.status !== 200) {
    throw new Error(`File could not be loaded from ${FILE_URL}. HTTP ${fileRes ? fileRes.status : 'no response'}`);
  }
  if (!fileRes.body || fileRes.body.byteLength === 0) {
    throw new Error('The downloaded file is empty. Check FILE_URL.');
  }
  pyroscope.instrumentHTTP();

  return { 
    // ArrayBuffer → base64 string so it survives JSON serialisation to VUs.
    fileContentB64: encoding.b64encode(fileRes.body), 
    email: email, 
    password: password 
  };
}

// ─────────────────────────────────────────
// VU CODE
// ─────────────────────────────────────────

export function run(data) {
  const testUser = {
    email: data.email,
    password: data.password
  };
  const fileContent = encoding.b64decode(data.fileContentB64, 'std');
  let cookie = null;
  let uploadedFileToken = null;
  let uploadedFileId = null;

  // ── Auth flow ─────────────────────────────────────────────────
  group('1. Authentication', () => {

    group('Login', () => {
      cookie = login(testUser.email, testUser.password);
    });

    sleep(SLEEP_TIME);

    group('Auth Me', () => {
      const res = http.get(
        `${BASE_URL}/api/auth/me`,
        { headers: makeHeaders(cookie), tags: { name: 'auth_me' } }
      );
      authMeDuration.add(res.timings.duration);
      errorRate.add(res.status !== 200);
      check(res, {
        'auth/me: status 200':         (r) => r.status === 200,
        'auth/me: authenticated true': (r) => r.json('authenticated') === true,
        'auth/me: has email':          (r) => r.json('email') !== null,
      });
    });
  });

  if (!cookie) {
    console.warn(`[VU ${__VU} iter ${__ITER}] Skipping file operations — auth failed`);
    return;
  }

  sleep(SLEEP_TIME);

  // ── File operations ────────────────────────────────────────────
  group('II. File operations', () => {
    group('1. File Upload', () => {
      const uploadPayload = {
        file:     http.file(fileContent, 'test-file.jpg', 'image/jpeg'),
        hash:     FILE_HASH,
        filename: 'test-file.jpg',
        email:    testUser.email,
        fileType: 'image/jpeg',
        fileSize: String(fileContent.byteLength),
      };
      if (FILE_PASSWORD)   
        uploadPayload['filePassword']   = FILE_PASSWORD;
      if (EXPIRATION_DAYS) 
        uploadPayload['expirationDays'] = String(EXPIRATION_DAYS);

      const uploadRes = http.post(
        `${BASE_URL}/api/files/upload`,
        uploadPayload,
        // Do NOT set Content-Type here — k6 sets multipart/form-data + boundary automatically
        { 
          headers: { Accept: 'application/json', Cookie: `${COOKIE_NAME}=${cookie}` },
          tags: {name: 'file_upload'}
        }
      );
      uploadDuration.add(uploadRes.timings.duration);

      const uploadOk = check(uploadRes, { 
        'upload: status 200': (r) => r.status === 200 
      });
      if (!uploadOk) 
        logFail('POST /api/files/upload', uploadRes);
      errorRate.add(uploadOk ? 0 : 1);

      if (uploadOk) {
        try { 
          uploadedFileToken = uploadRes.json('fileToken'); 
        } 
        catch (e) {
          console.error(`[VU ${__VU} iter ${__ITER}] Could not parse file_token from upload response: ${e.message}. Body: ${String(uploadRes.body).substring(0, 200)}`);
        }
      }
    });
    
    sleep(SLEEP_TIME);

    // GET /api/files/list
    group('2. File Listing', () => {
      const listRes = http.get(
        `${BASE_URL}/api/files/list?email=${encodeURIComponent(testUser.email)}`, 
        { headers: makeHeaders(cookie), tags: { name: 'file_list'} }
      );
      listFilesDuration.add(listRes.timings.duration);
      const listOk = check(listRes, { 
        'list files: status 200': (r) => r.status === 200 }
      );
      if (!listOk) 
        logFail('GET /api/files/list', listRes);
      
      errorRate.add(listOk ? 0 : 1);

      if(listOk && uploadedFileToken){
        const fileList = listRes.json('files');
        const found = fileList.find((f) => f.fileToken === uploadedFileToken);
        if (found) 
          uploadedFileId = found.id;
      }

      if (!uploadedFileToken) {
        console.warn(`[VU ${__VU} iter ${__ITER}] No file_token from upload — skipping info, download, delete`);
      }
    });
        
    sleep(SLEEP_TIME);

    // GET /api/files/info
    if (uploadedFileToken) {
      group('3. Get File Info', () => {
        const infoRes = http.get(
          http.url`${BASE_URL}/api/files/info?fileToken=${uploadedFileToken}`,
          { headers: makeHeaders(cookie) }
        );
        fileInfoDuration.add(infoRes.timings.duration);
        const infoOk = check(infoRes, { 
          'file info: status 200': (r) => r.status === 200 
        });
        if (!infoOk) 
          logFail(`GET /api/files/info?fileToken=${uploadedFileToken}`, infoRes);
          
        errorRate.add(infoOk ? 0 : 1);
      });
    }
    
    
    sleep(SLEEP_TIME);

    // POST /api/files/download (get link)
    if(uploadedFileId) {
      group('4. File Download', () => {
        let downloadUrl = null;
        group('4.a. Get Download Link', () => {
          const linkRes = http.post(
            `${BASE_URL}/api/files/download`,
            JSON.stringify({ id: uploadedFileId }),
            { headers: makeHeaders(cookie), tags: { name: 'file_download_link'} }
          );
          fileLinkDuration.add(linkRes.timings.duration);
          const linkOk = check(linkRes, { 
            'file link: status 200': (r) => r.status === 200 
          });
          if (!linkOk) 
            logFail('POST /api/files/download', linkRes);
          
          errorRate.add(linkOk ? 0 : 1);
          
          if (linkOk) {
            try { 
              downloadUrl = linkRes.json('fileLink'); 
            } catch (e) {
              console.error(`[VU ${__VU} iter ${__ITER}] Could not parse download URL: ${e.message}. Body: ${String(linkRes.body).substring(0, 200)}`);
            }
          }
        });
        if (downloadUrl) {
          group('4.b. Get File Blob', () => {
            const dlRes = http.get(
              downloadUrl, 
              { headers: makeHeaders(cookie),
              tags: { name: 'file_blob_download' }
            });
            downloadDuration.add(dlRes.timings.duration);
            const dlOk = check(dlRes, { 
              'download: status 200': (r) => r.status === 200 
            });
            if (!dlOk) 
              logFail(`GET ${downloadUrl}`, dlRes);

            errorRate.add(dlOk ? 0 : 1);
          });
        } else {
          console.warn(`[VU ${__VU} iter ${__ITER}] Download URL empty — skipping blob download`);
        }
      });
    }
            
    sleep(SLEEP_TIME);

    // DELETE /api/files/delete/:id
    if (uploadedFileId) {
      group('5. File Delete', () => {
        const delRes = http.del(
          http.url`${BASE_URL}/api/files/delete/${uploadedFileId}`,
          null,
          { headers: makeHeaders(cookie) }
        );
        deleteDuration.add(delRes.timings.duration);
        const delOk = check(delRes, { 
          'delete: status 200': (r) => r.status === 200 
        });
        if (!delOk) 
          logFail(`DELETE /api/files/delete/${uploadedFileId}`, delRes);
        
        errorRate.add(delOk ? 0 : 1);
      });
    }
        
  });

  sleep(SLEEP_TIME);

  // ── Logout ─────────────────────────────────────────────────────
  group('Logout', () => {
    const logoutRes = http.post(
      `${BASE_URL}/api/logout`, 
      null, 
      { headers: makeHeaders(cookie), tags: { name: 'logout'} }
    );
    const logoutOk = check(logoutRes, { 
      'logout: status 200': (r) => r.status === 200 
    });
    if (!logoutOk) 
      logFail('POST /api/logout', logoutRes);
      
    errorRate.add(logoutOk ? 0 : 1);
  });

  sleep(randomIntBetween(1, 3)); // TODO: adjust to match real user think time
}
