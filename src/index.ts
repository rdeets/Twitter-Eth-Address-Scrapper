require('dotenv').config();
import { ExtendedClient } from './Client';

export const client = new ExtendedClient({
	appKey: process.env.CONSUMER_KEY,
	appSecret: process.env.CONSUMER_SECRET,
	accessToken: process.env.ACCESS_TOKEN,
	accessSecret: process.env.ACCESS_TOKEN_SECRET
});

console.log(
	'------TWITTER ETH ADDRESS SCRAPPER------\n\n by Ryan Deets\n\nhttps://github.com/rdeets/\n'
);
client.start();
