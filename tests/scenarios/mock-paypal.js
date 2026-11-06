// Minimal PayPal sandbox stand-in for local end-to-end tests.
const http = require('http');
const orders = {}, auths = {}, refunds = {}, log = [];
let n = 0;
const id = (p) => (p + (++n).toString().padStart(12, '0')).toUpperCase().slice(0, 17);
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const u = req.url; log.push(req.method + ' ' + u);
    if (u === '/__log') return send(200, { log, orders, auths, refunds });
    if (u === '/v1/oauth2/token') return send(200, { access_token: 'A21-test', expires_in: 3600 });
    if (u === '/v3/vault/setup-tokens' && req.method === 'POST') {
      const b = JSON.parse(body); const sid = id('SETUP');
      return send(201, { id: sid, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'approve', href: `${b.payment_source.paypal.experience_context.return_url}&approval_token_id=${sid}&approval_session_id=S1` }] });
    }
    if (u === '/v3/vault/payment-tokens' && req.method === 'POST') return send(201, { id: id('PTOK'), customer: { id: 'CUST1' } });
    if (u === '/v2/checkout/orders' && req.method === 'POST' && JSON.parse(body).payment_source.paypal.vault_id) {
      const b = JSON.parse(body); const oid = id('ORD'); const aid = id('AUTH'); const amt = b.purchase_units[0].amount;
      orders[oid] = { b, status: 'COMPLETED', vault: b.payment_source.paypal.vault_id }; auths[aid] = { status: 'CREATED', amount: amt, vault: true };
      return send(201, { id: oid, status: 'COMPLETED', purchase_units: [{ shipping: { name: { full_name: 'Mohamed Test' }, address: { address_line_1: '12 Tahrir St', admin_area_2: 'Cairo', country_code: 'EG' } }, payments: { authorizations: [{ id: aid, status: 'CREATED', amount: { value: amt.value, currency_code: amt.currency_code } }] } }] });
    }
    if (u === '/v2/checkout/orders' && req.method === 'POST') {
      const b = JSON.parse(body); const oid = id('ORD');
      const it = b.purchase_units[0].items[0];
      if ((it.image_url && !/^https:\/\/[\w\-./%]+\.(jpe?g|png|gif)$/i.test(it.image_url)) || (it.url && it.url.includes('reject-me')))
        return send(400, { name: 'INVALID_REQUEST', details: [{ issue: 'INVALID_PARAMETER_SYNTAX', description: 'The value of a field does not conform to the expected format.' }] });
      const ret = b.payment_source.paypal.experience_context.return_url;
      orders[oid] = { b, status: 'PAYER_ACTION_REQUIRED' };
      return send(201, { id: oid, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: `${ret}?token=${oid}&PayerID=TESTBUYER1` }] });
    }
    let m;
    if ((m = u.match(/^\/v2\/checkout\/orders\/(\w+)\/authorize$/))) {
      const o = orders[m[1]]; if (!o) return send(404, { name: 'RESOURCE_NOT_FOUND' });
      const aid = id('AUTH'); const amt = o.b.purchase_units[0].amount;
      auths[aid] = { status: 'CREATED', amount: amt };
      return send(201, { id: m[1], status: 'COMPLETED', payment_source: { paypal: { email_address: 'buyer@personal.example.com' } },
        purchase_units: [{ shipping: { name: { full_name: 'Mohamed Test' }, address: { address_line_1: '12 Tahrir St', admin_area_2: 'Cairo', country_code: 'EG' } },
          payments: { authorizations: [{ id: aid, status: 'CREATED', amount: { value: amt.value, currency_code: amt.currency_code }, expiration_time: '2026-12-04T00:00:00Z' }] } }] });
    }
    if ((m = u.match(/^\/v2\/checkout\/orders\/(\w+)\/track$/))) { const b = JSON.parse(body); orders[m[1]].tracking = b; return send(201, { id: m[1], status: 'COMPLETED' }); }
    if ((m = u.match(/^\/v2\/payments\/captures\/(\w+)\/refund$/))) { const rid = id('REF'); refunds[rid] = { capture: m[1], note: JSON.parse(body).note_to_payer }; return send(201, { id: rid, status: 'COMPLETED', amount: { value: '226.40', currency_code: 'USD' } }); }
    if ((m = u.match(/^\/v2\/payments\/authorizations\/(\w+)\/capture$/))) { auths[m[1]].status = 'CAPTURED'; return send(201, { id: id('CAP'), status: 'COMPLETED' }); }
    if ((m = u.match(/^\/v2\/payments\/authorizations\/(\w+)\/void$/))) { auths[m[1]].status = 'VOIDED'; res.writeHead(204); return res.end(); }
    if ((m = u.match(/^\/v2\/payments\/authorizations\/(\w+)$/))) return send(200, { status: auths[m[1]].status });
    send(404, { name: 'NOT_FOUND', u });
  });
}).listen(4010, () => console.log('mock paypal on 4010'));
