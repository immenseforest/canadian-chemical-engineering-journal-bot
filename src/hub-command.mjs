import {SlashCommandBuilder,ChannelType} from 'discord.js';
import {catalog} from './hub-catalog.mjs';
const channel=o=>o.setName('channel').setDescription('Existing text channel for journal threads').addChannelTypes(ChannelType.GuildText).setRequired(true);
const subscription=o=>o.setName('subscription').setDescription('Journal ID from /journals list').setRequired(true);
export const hubCommand=new SlashCommandBuilder().setName('journals').setDescription('Choose and manage research journals').setDMPermission(false)
  .addSubcommand(s=>s.setName('help').setDescription('Explain the bot and all commands'))
  .addSubcommand(s=>s.setName('catalog').setDescription('Show the five ready-to-use journal profiles'))
  .addSubcommand(s=>s.setName('add').setDescription('Subscribe a journal in an existing channel').addStringOption(o=>o.setName('journal').setDescription('Journal to follow').setRequired(true).addChoices(...catalog.map(j=>({name:j.name.slice(0,100),value:j.id})))).addChannelOption(channel).addIntegerOption(o=>o.setName('history').setDescription('Previous issues to include, 0–9; default latest only').setMinValue(0).setMaxValue(9)).addBooleanOption(o=>o.setName('open-access-only').setDescription('Include only articles confirmed as open access')))
  .addSubcommand(s=>s.setName('add-link').setDescription('Paste an IEEE Xplore journal link in a short form').addChannelOption(channel))
  .addSubcommand(s=>s.setName('list').setDescription('List journal subscriptions and their IDs'))
  .addSubcommand(s=>s.setName('status').setDescription('Show schedules, errors and uncertain deliveries'))
  .addSubcommand(s=>s.setName('check').setDescription('Check subscribed journals now').addStringOption(o=>o.setName('subscription').setDescription('Optional journal ID; omit to check all')))
  .addSubcommand(s=>s.setName('pause').setDescription('Pause a journal subscription').addStringOption(subscription))
  .addSubcommand(s=>s.setName('resume').setDescription('Resume daily checks').addStringOption(subscription))
  .addSubcommand(s=>s.setName('remove').setDescription('Stop a subscription and keep its discussion threads').addStringOption(subscription))
  .addSubcommand(s=>s.setName('resolve').setDescription('Resolve an uncertain delivery after checking Discord').addStringOption(subscription).addStringOption(o=>o.setName('issue').setDescription('Exact issue key from /journals status').setRequired(true)).addStringOption(o=>o.setName('receipt').setDescription('Confirmed thread/message ID, or retry if not delivered').setRequired(true)))
  .addSubcommand(s=>s.setName('intro').setDescription('Post the introduction and command guide').addChannelOption(channel));
