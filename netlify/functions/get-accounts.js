// netlify/functions/get-accounts.js
// Returns the managed MCC accounts list (no API query, instant response)
const MANAGED_ACCOUNTS = [
  { id: '6457701262', name: 'Tri Tool Technologies', currency: 'ZAR', abbrev: 'TT' },
  { id: '3938092858', name: 'Spier E-commerce', currency: 'ZAR', abbrev: 'SP' },
  { id: '1174876049', name: 'Geddes Capital', currency: 'ZAR', abbrev: 'GC' },
  { id: '8808134001', name: 'AURA SOS', currency: 'ZAR', abbrev: 'AU' },
  { id: '3199837831', name: 'Snap Kitchen', currency: 'USD', abbrev: 'SK' },
  { id: '4379852145', name: '1Voucher', currency: 'ZAR', abbrev: '1V' },
  { id: '8391694125', name: 'Spier Hotel', currency: 'ZAR', abbrev: 'SH' },
  { id: '5010689409', name: 'Spier Destination', currency: 'ZAR', abbrev: 'SD' },
  { id: '2162040364', name: 'Fut Afrique', currency: 'ZAR', abbrev: 'FA' },
  { id: '4035336692', name: 'Tri Tool US Dollar', currency: 'USD', abbrev: 'TU' },
  { id: '1039498028', name: 'Tri Tool Inc.', currency: 'USD', abbrev: 'TI' },
  { id: '1504414244', name: 'Pesalink', currency: 'USD', abbrev: 'PL' },
  { id: '8043998866', name: 'Zapmed', currency: 'ZAR', abbrev: 'ZM' },
];

exports.handler = async (event) => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      ok: true,
      mcc: '9060186325',
      mcc_name: 'TMI MDO MCC',
      accounts: MANAGED_ACCOUNTS,
    }),
  };
};