import Biscoint from "biscoint-api-node";
import Bottleneck from "bottleneck";
import { handleMessage, handleError, percent } from "./utils";
//import config from "./config.js";
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';

//let { amount, initialSell, intervalMs, test, differencelogger } = config;

let {
  apiKey, apiSecret, amount, initialSell, intervalMs, test,
  differencelogger, token, botchat, botId, host, port, multibot
} = require("./env")

const bc = new Biscoint({
  apiKey: apiKey,
  apiSecret: apiSecret,
});

// multibot
let robo = new Object()
robo.id = botId
let botStatus
//if (!multibot) intervalMs = 5500

// Telegram
const bot = new Telegraf(token)
let balances

// const keyboard = Markup.inlineKeyboard(
//   [
//     Markup.button.callback('\u{1F9FE} Balance', 'balance'),
//     Markup.button.callback('\u{1F9FE} Configs', 'configs'),
//     Markup.button.callback('\u{1F51B} Test Mode', 'test'),
//     Markup.button.url('₿', 'https://www.biscoint.io')
//   ], { columns: 2 })

const keyboard = Markup.keyboard([
  ['🧾 Balance', '🔍 BTC Price'], // Row1 with 2 buttons
  ['☸ Configs', '📖 Help'], // Row2 with 2 buttons
  ['🔛 Test Mode', '₿'] // Row3 with 2 buttons
])
  .oneTime()
  .resize()

bot.hears('📖 Help', async (ctx) => {
  ctx.replyWithMarkdown(
    `*Comandos disponíveis:* 
      ============  
  *🧾 Balance:* Extrato resumido do saldo na corretora.\n
  *🔍 BTC Price:* Último preço do Bitcoin na corretora.\n
  *☸ Configs:* Configurações do Bot.\n
  *🔛 Test Mode:* Ativar/Desativar modo simulação.\n
  *₿:* Acessar a corretora.\n
      ============
      `, keyboard)
}
);

bot.hears('₿', async (ctx) => {
  ctx.reply('Clique para acessar a corretora https://biscoint.io', keyboard);
}
);

bot.hears('🧾 Balance', async (ctx) => {
  checkBalances();
}
);

bot.hears('🔛 Test Mode', async (ctx) => {
  if (test === false) {
    test = true
    ctx.reply('\u{1F6D1} Modo test ativado!', keyboard);
    checkBalances();
  } else {
    test = false
    ctx.replyWithMarkdown(`\u{1F911} Modo test desativado!`, keyboard);
    checkBalances();
  }
}
);

bot.hears('☸ Configs', (ctx) => {
  ctx.replyWithMarkdown(`
*Intervalo*: ${intervalMs}ms
*Modo teste*: ${test}
*Saldo*: ${amount}
    `, keyboard)
}
);

bot.hears('🔍 BTC Price', async (ctx) => {
  let priceBTC = await bc.ticker();
  ctx.replyWithMarkdown(`
*Preço BTC*: ${Number(priceBTC.last).toLocaleString('pt-br', { style: 'currency', currency: 'BRL' })}
    `, keyboard)
}
);


// Telegram End

const limiter = new Bottleneck({
  reservoir: 30,
  reservoirRefreshAmount: 30,
  reservoirRefreshInterval: 60 * 1000,
  maxConcurrent: 1,
});

handleMessage("\u{1F911} Iniciando Trades!");
bot.telegram.sendMessage(botchat, '\u{1F911} Iniciando Trades!', keyboard)

let tradeCycleCount = 0;

async function trade() {
  if (multibot && intervalMs === 2500) {
    const res = await axios.post(`http://${host}:${port}/status`, robo)
    botStatus = res.data
  } else {
    botStatus = true
  }

  if (botStatus) {
    try {
      const sellOffer = await bc.offer({
        amount,
        isQuote: false,
        op: "sell",
      });

      const buyOffer = await bc.offer({
        amount,
        isQuote: false,
        op: "buy",
      });

      const profit = percent(buyOffer.efPrice, sellOffer.efPrice);
      if (differencelogger) {
        handleMessage(`Variação de preço: ${profit.toFixed(3)}%`);
        handleMessage(`O botStatus é: ${botStatus}`)
        handleMessage(`Intervalo: ${intervalMs}ms`)
        handleMessage(`Test mode: ${test}`);
      }
      if (buyOffer.efPrice < sellOffer.efPrice && !test) {
        handleMessage(`\u{1F911} Sucesso! Lucro: ${profit.toFixed(3)}%`);
        bot.telegram.sendMessage(botchat, `Profit found: ${profit.toFixed(3)}%`, keyboard)
        if (initialSell) {
          /* initial sell */
          try {
            await bc.confirmOffer({ offerId: sellOffer.offerId });
            handleMessage("Success on sell");
            try {
              await bc.confirmOffer({
                offerId: buyOffer.offerId,
              });
              handleMessage("Success on buy");
              tradeCycleCount += 1;
              handleMessage(
                `Success, profit: + ${profit.toFixed(
                  3
                )}%, cycles: ${tradeCycleCount}`
              );
            } catch (error) {
              handleError("Error on buy, retrying", error);
              await forceConfirm("buy", sellOffer.efPrice);
            }
          } catch (error) {
            handleError("Error on sell", error);
            bot.telegram.sendMessage(botchat, `Error on sell: ${error}`, keyboard)
            if (error.error === "Insufficient funds") {
              initialSell = !initialSell;
              handleMessage("Switched to first buy");
            }
          }
        } else {
          /* initial buy */
          try {
            await bc.confirmOffer({ offerId: buyOffer.offerId });
            handleMessage("Success on buy");
            try {
              await bc.confirmOffer({ offerId: sellOffer.offerId });
              handleMessage("Success on sell");
              tradeCycleCount += 1;
              handleMessage(
                `Success, profit: + ${profit.toFixed(
                  3
                )}%, cycles: ${tradeCycleCount}`
              );
            } catch (error) {
              handleError("Error on sell, retrying", error);
              await forceConfirm("sell", buyOffer.efPrice);
            }
          } catch (error) {
            handleError("Error on buy", error);
            bot.telegram.sendMessage(botchat, `Error on buy: ${error}`, keyboard)
            if (error.error === "Insufficient funds") {
              initialSell = !initialSell;
              handleMessage("Switched to first sell");
            }
          }
        }
      }
    } catch (error) {
      handleError("Error on get offer", error);
    }
  } else {
    handleMessage('Aguardando...');
    handleMessage(`O botStatus é: ${botStatus}`)
    handleMessage(`Intervalo: ${intervalMs}ms`)
  }
}

setInterval(() => {
  limiter.schedule(() => trade());
}, intervalMs);

async function forceConfirm(side, oldPrice) {
  try {
    const offer = await bc.offer({
      amount,
      isQuote: false,
      op: side,
    });

    // if side is buy then compare with sell price
    if (
      (side === "buy" && oldPrice * 1.1 >= Number(offer.efPrice)) ||
      (side === "sell" && oldPrice * 0.9 <= Number(offer.efPrice))
    ) {
      await bc.confirmOffer({ offerId: offer.offerId });
      handleMessage("Success on retry");
    } else {
      //throw "Error on forceConfirm, price is much distant";
      bot.telegram.sendMessage(botchat, `
      Erro ao Confirmar Ordem, o preço está muito distante.
      Acesse a corretora e verifique seu saldo!`, keyboard)
    }
  } catch (error) {
    handleError("Error on force confirm", error);
    bot.telegram.sendMessage(botchat, `Error on force confirm: ${error}`, keyboard)
  }
}

const checkBalances = async () => {
  balances = await bc.balance();
  const { BRL, BTC } = balances;
  let priceBTC = await bc.ticker();

  await bot.telegram.sendMessage(botchat,
    `\u{1F911} Balanço:
<b>Status</b>: ${!test ? `\u{1F51B} Robô operando.` : `\u{1F6D1} Modo simulação.`} 
<b>Amount Configurado</b>: ${amount}
<b>BRL:</b> ${BRL} 
<b>BTC:</b> ${BTC} (R$ ${(priceBTC.last * BTC).toFixed(2)})
`, { parse_mode: "HTML" });
  await bot.telegram.sendMessage(botchat, "Extrato resumido. Para maiores detalhes, acesse a corretora Biscoint!", keyboard)

  handleMessage(`Balances:  BRL: ${BRL} - BTC: ${BTC} `);
};

// Check interval
const checkInterval = async () => {
  const { endpoints } = await bc.meta();
  const { windowMs, maxRequests } = endpoints.offer.post.rateLimit;
  handleMessage(`Offer Rate limits: ${maxRequests} request per ${windowMs}ms.`);
  let minInterval = 2.0 * parseFloat(windowMs) / parseFloat(maxRequests);

  if (multibot) {
    intervalMs = 2500.0;
    handleMessage(`Setting interval to ${intervalMs}s`);
    //} else if (intervalMs < minInterval) {
  } else {
    //handleMessage(`Interval too small (${intervalMs}s). Must be higher than ${minInterval.toFixed(1)}s`, 'error', false);
    handleMessage(`Interval too small (${intervalMs}s). Must be higher than ${minInterval.toFixed(1)}s`);
    intervalMs = minInterval;
  }
};

async function start() {
  handleMessage('Starting trades');
  bot.telegram.sendMessage(botchat, '\u{1F911} Iniciando trades!');
  await checkInterval();
  setInterval(async () => {
    limiter.schedule(() => trade());
  }, intervalMs * 1000);
}

bot.launch()

start().catch(e => handleMessage(JSON.stringify(e), 'error'));
