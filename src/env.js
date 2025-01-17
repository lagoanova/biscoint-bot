// read .env file into proces.env
require("dotenv").config()

const envalid = require("envalid")

module.exports = envalid.cleanEnv(process.env, {
    apiKey: envalid.str({ default: "" }),
    apiSecret: envalid.str({ default: "" }),
    amount: envalid.num({ default: "0.001" }),
    amountInitial: envalid.num({ default: "300" }),
    initialSell: envalid.bool({ default: true }),
    intervalMs: envalid.num( { default: "" } ),
    test: envalid.bool({ default: false }),
    differencelogger: envalid.bool({ default: true }),
    token: envalid.str({ default: "" }),
    botchat: envalid.str({ default: "" }),
    botId: envalid.str({ default: "bot_1" }),
    host: envalid.str({ default: "localhost" }),
    port: envalid.num({
        default: 80,
        desc: "The port to start the server on",
    }),
    multibot: envalid.bool({ default: true }),
    dataInicial: envalid.str({ default: "01/09/2021" }),
})