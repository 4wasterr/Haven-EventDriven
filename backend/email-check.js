const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const { checkEmailAccess } = require("./email");

checkEmailAccess().then(result => {
    console.log(`Email provider: ${result.provider}`);
    console.log(result.message);
    if (!result.ready) process.exitCode = 1;
}).catch(error => { console.error(error.message); process.exitCode = 1; });
