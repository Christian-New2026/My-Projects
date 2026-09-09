require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./config/db');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const centreGroups = {
      'Mathare Cluster': [
        'Craig Quinell KAG Kariobangi', 'Hope Baptist Children Centre', "St. Benedict's",
        'Sim Wood Billian', 'Mashimoni', 'Mennonite Mukuru Primary School', 'Kijee TV',
        'Mathare Social Justice Centre', 'Kabiro', 'Gitathuru Huruma', 'Mtatu A', 'Mathare 4B',
        'Dandora Girls', 'Bro Dinefwr Kambi Moto', 'Madoya', 'Kosovo', 'Wamuini Sec', 'Majengo',
        'Valley Bridge', 'Shield Foundation (Mathare Area A)', 'Mathari Mixed Sec',
        'George North Kiamutisya', 'Kiandutu', 'Eddie Maguire Mwamko', 'Mr. Mike Muslim Kawangware'
      ],
      'Kibera Cluster': [
        "St. Michael's Mukuru", 'Tumaini Gituamba', 'Saviour King', 'Kibera Glory', 'Silver Spring',
        'Ushirika Girls', 'Tumaini Hope Raila Centre', 'John Paul II', 'Calvary High', "St. Mary's Kibera"
      ],
      'Kajiado Cluster': ['Bissil', 'Maparasha', 'Nentonai', 'Kurket'],
      'Arusha Cluster': ['Olkereyan', 'Salei', 'Burka', 'Kiranyi', 'Azimio'],
      'Mt. Kenya Cluster': ['Wanjerere', 'Tetu Boys', 'Njogu-ini', 'Kambirwa', 'Bondeni', "King'ong'o"],
      'Mombasa Cluster': ['Vikwatani', 'Majengo Mapya', 'Hope for Hope', 'Matopeni', 'Changamwe']
    };

    const centreRows = [];
    for (const [location, names] of Object.entries(centreGroups)) {
      for (const name of names) {
        const { rows } = await client.query(
          `INSERT INTO centres (name, location) VALUES ($1, $2)
           ON CONFLICT (name, location) DO UPDATE SET name = EXCLUDED.name
           RETURNING id, name, location`,
          [name, location]
        );
        centreRows.push(rows[0]);
      }
    }

    const budgetLineSeed = [
      ['Salaries and Wages', 13174633],
      ['Supervisors monthly allowances for 55 SOH', 2640000],
      ['Accelerated Learning Program in 21 regular Schools for 6 months and 10 SOH for 11 months', 1602766],
      ['Sanitary pads for 2,000 Girls', 1200000],
      ['Kabiro establishment of a Laboratory', 1160000],
      ['Insurance (General & Medical)', 749150],
      ['Textbooks for 27 SOH', 675000],
      ['Establishment of two new SOH in Mombasa', 335380],
      ['SOH- Coordination & Monitoring within Nairobi', 330000],
      ['Sports Festivals (Rugby) in 3 regions', 303800],
      ['Supervisors Quarterly Meetings Fare in 50 SOH', 300000],
      ['E-learning in 10 Schools - Internet and Equipments', 297000],
      ['Office Rent', 264000],
      ['Support for Special Children - Billian Centre', 240000],
      ['Support for Arusha 5 SOH', 240000],
      ['Lifeskills Sessions in 55 SOH and Boys and Girls club activities', 233600],
      ['Quarterly Monitoring visits - Mombasa, Arusha, Kajiado & Mt Kenya', 219000],
      ["Supervisors' Motivation and Welfare Support", 215000],
      ['Debate Contest in Mathare and Kibera and Talent Festival in Mombasa & Arusha', 206300],
      ['Teachers in-service Training for 180 Teachers', 189000],
      ['Educational Support for 2 needy students - Boarding high School', 183000],
      ['Mileage payment', 180000],
      ['Stationery, Office supplies and accounting system', 169000],
      ['Sports Equipment for 55 SOH', 165000],
      ['Eddie Maguire SOH Kahawa Soweto - Year 3 support', 135000],
      ['Wamuini SOH - Year 2 support', 115000],
      ['Chess - Regional and National Championship', 114000],
      ['Communication - Internet, Wifi, staff airtime and Website Hosting', 112800],
      ['Audit Fees', 110000],
      ['Collaboration and Networking activities', 96000],
      ['Office Equipment', 96000],
      ['Quarterly Trustees Meetings and Transport for Iestyn and staff meetings with Iestyn', 92000],
      ['10 SOH Holiday Revision Camps for Candidates - April and August holidays', 65000],
      ['Bank charges - Mpesa and Bank Charges', 60000],
      ['Dandora Girls Secondary School', 50780],
      ['Maparasha SOH Year 3 support', 47000],
      ["St. Mary's SOH Year 3 support", 45000],
      ['Students Career Roundtable with Mentors - 30 students', 40000],
      ['First Aid Kits for 55 SOH - Replenishing of the kits', 37500],
      ['Contribution for Electricity for SOH and support for 43 SOH committees', 32300],
      ['Production of IEC Materials and Documentation', 20000],
      ['Training of supervisors on safeguarding', 15000]
    ];

    const blRows = [];
    for (const [name, allocatedAmount] of budgetLineSeed) {
      const { rows } = await client.query(
        `INSERT INTO budget_lines (name, centre_id, allocated_amount) VALUES ($1, NULL, $2)
         ON CONFLICT DO NOTHING RETURNING id, name`,
        [name, allocatedAmount]
      );
      if (rows[0]) blRows.push(rows[0]);
      else {
        const existing = await client.query(
          'SELECT id, name FROM budget_lines WHERE name = $1 AND centre_id IS NULL ORDER BY created_at LIMIT 1',
          [name]
        );
        blRows.push(existing.rows[0]);
        await client.query('UPDATE budget_lines SET allocated_amount = $1 WHERE id = $2', [allocatedAmount, existing.rows[0].id]);
      }
    }

    const salaryLine = blRows.find((line) => line.name === 'Salaries and Wages');
    await client.query(
      `UPDATE payment_requests SET budget_line_id = $1
       WHERE budget_line_id IN (SELECT id FROM budget_lines WHERE name IN ('Coach Fees Q1', 'Foodstuffs Q1'))`,
      [salaryLine.id]
    );
    await client.query("DELETE FROM budget_lines WHERE name IN ('Coach Fees Q1', 'Foodstuffs Q1')");
    const mathare = centreRows.find((c) => c.name === 'Mathare Social Justice Centre');

    const seedUsers = [
      { name: 'Admin User', email: process.env.SEED_ADMIN_EMAIL || 'admin@challengeaid.org', role: 'admin' },
      { name: 'Finance Officer', email: 'finance@challengeaid.org', role: 'finance' },
      { name: 'Programme Director', email: 'director@challengeaid.org', role: 'director' },
      { name: 'Staff Member', email: 'staff@challengeaid.org', role: 'staff' },
      { name: 'Trustee One', email: 'trustee1@challengeaid.org', role: 'trustee' },
      { name: 'Trustee Two', email: 'trustee2@challengeaid.org', role: 'trustee' },
      { name: 'Trustee Three', email: 'trustee3@challengeaid.org', role: 'trustee' },
      { name: 'Trustee Four', email: 'trustee4@challengeaid.org', role: 'trustee' }
    ];

    const defaultPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    for (const u of seedUsers) {
      await client.query(
        `INSERT INTO users (name, email, password_hash, role, centre_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING`,
        [u.name, u.email, passwordHash, u.role, mathare.id]
      );
    }

    await client.query('COMMIT');
    console.log('Seed complete.');
    console.log(`Centres seeded: ${centreRows.length}`);
    console.log(`Budget lines: ${blRows.map((b) => b.name).join(', ')}`);
    console.log(`Users seeded with password: ${defaultPassword} (change immediately)`);
    seedUsers.forEach((u) => console.log(`  - ${u.role}: ${u.email}`));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
