const bcrypt = require('bcryptjs');

const hash1 = '$2a$10$hv18YcMHa3uFx1d5TLrNzOpuVPsY68faHkWC/rUYT5FiToUwbIFOi'; // Tienda Search B22
const hash2 = '$2a$10$wj/PYz74I2NZp3WvGTkgHunEZH8v8Ge72zieNZro1ZKslsL0mIIe.'; // Tienda B22
const hash3 = '$2a$10$pAY7EKwW3HtWloOinrss.OBFcjmDKYp6uq4c8fjB2QLz6m3f40ETe'; // Tienda NoDoc B21
const hash4 = '$2a$10$3oQ/AJrPJxk9PRc4f20IG.WAyIDhgqq1Glxz8ynLF.pKs5oCHfUgO'; // admin

async function check() {
  const passwords = ['Zeudin2026!', 'Test1234!', 'password', '123456', 'admin'];
  
  console.log("Checking admin hash (should be Zeudin2026!)");
  for (const p of passwords) {
    if (bcrypt.compareSync(p, hash4)) console.log(`Admin password is: ${p}`);
  }

  console.log("Checking Tienda Search B22 hash");
  for (const p of passwords) {
    if (bcrypt.compareSync(p, hash1)) console.log(`Tienda Search B22 password is: ${p}`);
  }
}

check();
