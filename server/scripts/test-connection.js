/**
 * Quick sanity check for your Apps Script setup.
 * Usage: node server/scripts/test-connection.js
 */
import 'dotenv/config';
import { fetchData } from '../src/appsScript.js';

async function main() {
  console.log('Contacting your Apps Script web app...');
  const data = await fetchData();
  console.log(`Connected! Found ${data.ipos.length} IPO row(s) and ${data.applicants.length} applicant row(s).`);
  console.log('\nAll good! You can now run: npm run dev');
}

main().catch((err) => {
  console.error('\nConnection test failed:', err.message);
  console.error(
    '\nCommon causes:\n' +
      '  - APPS_SCRIPT_URL is wrong, or missing the trailing /exec.\n' +
      '  - APPS_SCRIPT_SECRET does not match the SECRET value in your Code.gs.\n' +
      '  - The deployment\'s "Who has access" is not set to "Anyone".\n' +
      '  - You edited Code.gs after deploying but created a "new deployment" version\n' +
      '    without updating the URL - or forgot to redeploy after changes.'
  );
  process.exit(1);
});
