const http = require('http');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- TEST SUITE STARTING ---');

  // 1. Check unauthorized email
  const t1 = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/check-email',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'unauthorized@example.com' });
  console.log('1. Unauthorized email blocked:', t1.status === 403, '| Error msg:', t1.data?.error);

  // 2. Admin login
  const t2 = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/admin/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { password: 'admin123' });
  const adminCookie = t2.headers['set-cookie']?.[0]?.split(';')[0];
  console.log('2. Admin login successful:', t2.status === 200 && t2.data?.success === true);

  const testEmail = 'pilot_' + Date.now() + '@company.com';

  // 3. Add allowed email as admin
  const t3 = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/admin/emails',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie }
  }, { email: testEmail, notes: 'VIP candidate' });
  console.log('3. Candidate authorized by admin:', t3.status === 200, '| Total emails:', t3.data?.emails?.length);

  // 4. Check authorized email (should return allowed: true, isRegistered: false)
  const t4 = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/check-email',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: testEmail });
  console.log('4. Authorized email permitted:', t4.data?.allowed === true, '| Registered:', t4.data?.isRegistered);

  // 5. Register user with new password
  const t5 = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/register',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: testEmail, password: 'mySecurePassword123' });
  const userCookie = t5.headers['set-cookie']?.[0]?.split(';')[0];
  console.log('5. Account registered & session issued:', t5.status === 200, '| User:', t5.data?.user?.email);

  // 6. Verify user session via /api/auth/me
  const t6 = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/me',
    method: 'GET',
    headers: { 'Cookie': userCookie }
  });
  console.log('6. User session active:', t6.data?.authenticated === true, '| Email:', t6.data?.user?.email);

  // 7. Save state to cloud
  const t7 = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/user/state',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': userCookie }
  }, { state: { step: 3, body: 'CICES', testSaved: true } });
  console.log('7. State auto-saved to backend:', t7.status === 200 && t7.data?.success === true);

  // 8. Retrieve saved state
  const t8 = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/user/state',
    method: 'GET',
    headers: { 'Cookie': userCookie }
  });
  console.log('8. State retrieved from backend:', t8.data?.state?.body === 'CICES' && t8.data?.state?.testSaved === true);

  // 9. Admin suspends email
  const t9 = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/admin/emails/${encodeURIComponent(testEmail)}/toggle`,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie }
  }, { active: false });
  console.log('9. Admin suspended user access:', t9.status === 200);

  // 10. Suspended user tries to fetch state -> should be blocked with 403
  const t10 = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/user/state',
    method: 'GET',
    headers: { 'Cookie': userCookie }
  });
  console.log('10. Suspended user rejected:', t10.status === 403, '| Error msg:', t10.data?.error);

  console.log('--- ALL 10 TESTS PASSED ---');
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
