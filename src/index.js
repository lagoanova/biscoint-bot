import Biscoint from "biscoint-api-node";
import Bottleneck from "bottleneck";
import { handleMessage, handleError, percent } from "./utils";
//import config from "./config.js";
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';

//let { amount, initialSell, intervalMs, test, differencelogger } = config;

let {
  apiKey, apiSecret, amount, initialSell, intervalMs, test,
  differencelogger, token, botchat, botId, host, port, multibot,
  dataInicial
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
  ['🧾 Extrato', '🔍 BTC Price'], // Row1 with 2 buttons
  ['☸ Configs', '💵 Increase Amount'], // Row2 with 2 buttons
  ['🔛 Test Mode', '💶 Buy BTC'], // Row3 with 2 buttons
  ['📖 Help', '₿'] // Row3 with 2 buttons
])
  .oneTime()
  .resize()

bot.hears(/oi|Oi|olá|Olá|kkk|ei|Ei|Hi|hi|help|ajuda/g, (ctx) => ctx.reply('Olá!', keyboard))

bot.hears('📖 Help', async (ctx) => {
  ctx.replyWithMarkdown(
    `*Comandos disponíveis:* 
      ============  
  *🧾 Extrato:* Extrato resumido do saldo na corretora.\n
  *🔍 BTC Price:* Último preço do Bitcoin na corretora.\n
  *☸ Configs:* Configurações do Bot.\n
  *🔛 Test Mode:* Ativar/Desativar modo simulação.\n
  *💵 Increase Amount:* Fixa o valor do 'saldo em operação' para 90% do BTC disponível.\n
  *₿:* Acessar a corretora.\n
      ============
      `, keyboard)
}
);

bot.hears('₿', async (ctx) => {
  ctx.reply('Clique para acessar a corretora https://biscoint.io', keyboard);
}
);

bot.hears('💶 Buy BTC', async (ctx) => {
  balances = await bc.balance();
  const { BRL } = balances;
  ctx.replyWithMarkdown(`Para comprar Bitcoin digite /comprar *valor*. Ex.: /valor *50*
*Seu saldo atual em BRL*: ${BRL}`);
}
);

bot.hears(/^\/comprar (.+)$/, async ctx => {
  let valor = ctx.match[1];
  buyBTC(valor)
}
)

bot.hears('🧾 Extrato', async (ctx) => {
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
*Configurações:*
⏱️ *Intervalo*: ${intervalMs}s
ℹ️ *Modo teste*: ${test ? 'ativado' : 'desativado'}
💵 *Saldo em operação*: ${amount}
✔️ *Multibot*: ${multibot ? 'ativado' : 'desativado'}
✔️ *initialSell*: ${initialSell ? 'ativado' : 'desativado'}
    `, keyboard)
}
);

bot.hears('🔍 BTC Price', async (ctx) => {
  let priceBTC = await bc.ticker();
  ctx.replyWithMarkdown(`*Biscoint:*
📊 *Último preço:* ${Number(priceBTC.last).toLocaleString('pt-br', { style: 'currency', currency: 'BRL' })}
📈 *Alta de hoje:* ${Number(priceBTC.high).toLocaleString('pt-br', { style: 'currency', currency: 'BRL' })}
📉 *Baixa de hoje:* ${Number(priceBTC.low).toLocaleString('pt-br', { style: 'currency', currency: 'BRL' })}
 ₿ *Volume:* ${Number(priceBTC.vol)} BTC
`, keyboard)
}
);

bot.hears('💵 Increase Amount', async (ctx) => {
  await increaseAmount();
}
);

bot.hears(/^\/vender (.+)$/, async (ctx) => {
  let valor = ctx.match[1];
  await realizarLucro(valor)
}
)

// Telegram End

// Checks that the configured interval is within the allowed rate limit.
const checkInterval = async () => {
  const { endpoints } = await bc.meta();
  const { windowMs, maxRequests } = endpoints.offer.post.rateLimit;
  handleMessage(`Offer Rate limits: ${maxRequests} request per ${windowMs}ms.`);
  let minInterval = 2.0 * parseFloat(windowMs) / parseFloat(maxRequests) / 1000.0;

  if (multibot) {
    intervalMs = 2.5;
    handleMessage(`Setting interval to ${intervalMs}s`);
  } else {
    //handleMessage(`Interval too small (${intervalMs}s). Must be higher than ${minInterval.toFixed(1)}s`, 'error', false);
    //handleMessage(`Interval too small (${intervalMs}s). Must be higher than ${minInterval.toFixed(1)}s`);
    intervalMs = minInterval;
  }
};

const limiter = new Bottleneck({
  reservoir: 30,
  reservoirRefreshAmount: 30,
  reservoirRefreshInterval: 60 * 1000,
  maxConcurrent: 1,
});

handleMessage("\u{1F911} Iniciando Trades!");

let tradeCycleCount = 0;

async function trade() {
  if (multibot) {
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
        handleMessage(`📈 Variação de preço: ${profit.toFixed(3)}%`);
        handleMessage(`O botStatus é: ${botStatus}`)
        handleMessage(`Multibot: ${multibot}`)
        handleMessage(`Intervalo: ${intervalMs}s`)
        handleMessage(`Test mode: ${test}`);
      }
      if (buyOffer.efPrice < sellOffer.efPrice && !test) {
        handleMessage(`\u{1F911} Sucesso! Lucro: ${profit.toFixed(3)}%`);
        //bot.telegram.sendMessage(botchat, `\u{1F911} Sucesso! Lucro: ${profit.toFixed(3)}%`, keyboard)
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
              bot.telegram.sendMessage(botchat, `\u{1F911} Sucesso! Lucro: ${profit.toFixed(3)}%`, keyboard);
              await increaseAmount();
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
            // test para comprar
            let { BRL, BTC } = await bc.balance();
            let buyBTCBalance = await buyBTC(BRL)
            if (buyBTCBalance) {
              bot.telegram.sendMessage(botchat, `Lucro realizado. Valor: ${BTC}`, keyboard);
              await increaseAmount()
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
              bot.telegram.sendMessage(botchat, `\u{1F911} Sucesso! Lucro: ${profit.toFixed(3)}%`, keyboard);
              await increaseAmount();
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
            // test para comprar
            let { BRL, BTC } = await bc.balance();
            let buyBTCBalance = await buyBTC(BRL)
            if (buyBTCBalance) {
              bot.telegram.sendMessage(botchat, `Lucro realizado. Valor: ${BTC}`, keyboard);
              await increaseAmount()
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
    handleMessage(`Multibot: ${multibot}`)
    handleMessage(`Intervalo: ${intervalMs}s`)
    handleMessage(`Test mode: ${test}`);
  }
}

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
      await increaseAmount();
    } else {
      //throw "Error on forceConfirm, price is much distant";
      bot.telegram.sendMessage(botchat, `
      Erro ao Confirmar Ordem, o preço está muito distante.
      Acesse a corretora e verifique seu saldo!`, keyboard)
      // Mode test
      //test = true;
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

  // Pegando a data
  let data = dataInicial

  // Precisamos quebrar a string para retornar cada parte
  const dataSplit = data.split('/');

  const day = dataSplit[0]; // 30
  const month = dataSplit[1]; // 03
  const year = dataSplit[2]; // 2019

  // Agora podemos inicializar o objeto Date, lembrando que o mês começa em 0, então fazemos -1.
  data = new Date(year, month - 1, day);
  const now = new Date(); // Data de hoje
  const past = new Date(data); // Outra data no passado
  const diff = Math.abs(now.getTime() - past.getTime()); // Subtrai uma data pela outra
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24)); // Divide o total pelo total de milisegundos correspondentes a 1 dia. (1000 milisegundos = 1 segundo).

  await bot.telegram.sendMessage(botchat,
    `\u{1F911} Balanço:
<b>Status</b>: ${!test ? `\u{1F51B} Robô operando.` : `\u{1F6D1} Modo simulação.`} 
<b>Data inicial</b>: ${dataInicial}
<b>Dias ativado</b>: ${days}
<b>Valor em operação</b>: ${amount}
<b>Saldo BRL:</b> ${BRL} 
<b>Saldo BTC:</b> ${BTC} (R$ ${(priceBTC.last * BTC).toFixed(2)})
`, { parse_mode: "HTML" });
  await bot.telegram.sendMessage(botchat, "Extrato resumido. Para maiores detalhes, acesse a corretora Biscoint!", keyboard)

  handleMessage(`Balances:  BRL: ${BRL} - BTC: ${BTC} `);
};


async function buyBTC(valor) {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        if (valor >= 50) {
          let buyOffer = await bc.offer({
            amount: valor,
            isQuote: true,
            op: "buy"
          });
          try {
            await bc.confirmOffer({
              offerId: buyOffer.offerId,
            });
            bot.telegram.sendMessage(botchat, `Compra de ${valor} em BTC efetuada com sucesso!`);
            resolve(true)
          } catch (error) {
            if (error.error === "Insufficient funds") {
              bot.telegram.sendMessage(botchat, `Você não tem saldo suficiente em BRL!`, keyboard);
            } else {
              bot.telegram.sendMessage(botchat, `${error.error}. ${error.details}`);
            }
            reject(false)
          }
        }
        else {
          bot.telegram.sendMessage(botchat, "Valor de compra abaixo do limite mínimo de 50 reais", keyboard);
          reject(false)
        }
      } catch (error) {
        bot.telegram.sendMessage(botchat, `${error.error}. ${error.details}`, keyboard);
        reject(false)
      }
    })();
  }).catch(err => {
    console.error(err)
  })
}

const increaseAmount = async () => {
  try {
    let { BRL, BTC } = await bc.balance();
    let amountBTC = (BTC * 0.9).toFixed(5) // pega 90% do saldo em Bitcoin e coloca para operação
    if (amountBTC >= 0.0001) {
      amount = amountBTC
      bot.telegram.sendMessage(botchat, `💵 *Valor em operação*: ${amount}`, keyboard)
    }
  } catch (error) {
    handleMessage(JSON.stringify(error));
    bot.telegram.sendMessage(botchat, JSON.stringify(error))
  }
}

async function start() {
  handleMessage('Starting trades');
  bot.telegram.sendMessage(botchat, '\u{1F911} Iniciando trades!', keyboard);
  await checkInterval();
  await increaseAmount();
  setInterval(async () => {
    limiter.schedule(() => trade());
  }, intervalMs * 1000);
}

bot.launch()

start().catch(e => handleMessage(JSON.stringify(e), 'error'));
