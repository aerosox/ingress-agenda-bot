const MongoClient = require('mongodb').MongoClient
const Agenda = require('agenda')
const Telegraf = require('telegraf')
const {Extra, Markup} = require('telegraf')

var mongoUrl = "mongodb://127.0.0.1/agenda"
var botToken = 'telegram-token'

const bot = new Telegraf(botToken)

// Hackish way for padding 0s. pad(3, 1) -> "001"
function pad(length, number) {
  var padding = new Array(length).fill(0).join('')
  var n = String(number)
  return n.length>=length?n:(padding+n).slice(-length)
}

var updateHack = (db, userid, date) => {
  db.collection('users').updateOne(
    { id: userid },
    {
      $set: {lastHack: date}
    },
    { upsert: true }
  )
}

var updateSojournerAlert = (db, userid, date) => {
  db.collection('users').updateOne(
    { id: userid },
    {
      $set: {lastAlert: date}
    }
  )
}

MongoClient.connect(mongoUrl, (err, db) => {

if (err) return console.error(err)
console.log("Connected to MongoDB :)")

bot.command('start', (ctx) => {
  ctx.reply(
    `Hi there!\n` +
    `For now, you can use /hack to tell me you've done your job.\n` +
    `I'll remind you your sojourner when you have one hour left!`,
    Extra.HTML()
  )
})

bot.command('hack', (ctx) => {
  let d = new Date()
  updateHack(db, ctx.message.from.id, d)
  ctx.reply(`<b>[${d.getHours()}:${d.getMinutes()}]</b>\nHack confirmed.`, {parse_mode: 'html'})
})

bot.action('hack', (ctx) => {
  let d = new Date()
  updateHack(db, ctx.from.id, d)
  ctx.answerCallbackQuery(
    `[ ${d.getHours()}:${d.getMinutes()} ]\nHack confirmed.`, '', true)
})

var agenda = new Agenda({mongo: db})
agenda.define('sojourner alert', function(job, done) {
  let min = new Date()
  min.setDate(min.getDate()-1)
  min.setHours(min.getHours()-1)
  let max = new Date()
  max.setDate(max.getDate()-1)
  let lastAlert = new Date()
  lastAlert.setMinutes(lastAlert.getMinutes()-30)
  db.collection('users')
    .find({
      lastHack: {
        $gte: min,
        $lt:  max
      },
      $or: [
        {lastAlert: {$lt:  lastAlert}},
        {lastAlert: {$exists: false}}
      ]
    })
    .each((err, res) => {
      if (err) return console.log(err)
      if (!res) return done()
      let lastHack = res.lastHack
      bot.telegram.sendMessage(res.id,
        `<b>[ Warning! ]</b>\n` +
        `Your last hack was yesterday at ${pad(2, lastHack.getHours())}:${pad(2, lastHack.getMinutes())}!`,
        Extra.HTML()
          .markup((m) => m.inlineKeyboard([
            m.callbackButton('Hack done!', 'hack')
          ]))
      )
      updateSojournerAlert(db, res.id, new Date())
    })
})

agenda.on('ready', () => {
  console.log('Agenda ready!')
  agenda.every('5 minutes', 'sojourner alert')
  agenda.start()
  bot.startPolling()
})

var graceful = () => {
  agenda.stop(() => {
    console.log('\rAgenda stopped...')
    process.exit(0)
  })
}
process.on('SIGTERM', graceful)
process.on('SIGINT' , graceful)

})
