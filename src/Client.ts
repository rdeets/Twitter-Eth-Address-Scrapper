import {
	TwitterApiReadOnly,
	Tweetv2TimelineResult,
	ApiResponseError
} from 'twitter-api-v2';
import fs from 'fs';
import readline from 'readline';
import open from 'open';
import { providers, utils } from 'ethers';

interface Tokens {
	accessToken: string;
	accessSecret: string;
	appKey: string;
	appSecret: string;
}

interface DiscordEntries {
	opened: boolean;
	userId: string;
}

interface AddressEntries {
	userId: string;
	balance: number;
}

export class ExtendedClient extends TwitterApiReadOnly {
	ensNames: Map<string, AddressEntries> = new Map();
	ethAddresses: Map<string, AddressEntries> = new Map();
	filteredAddresses: Map<string, AddressEntries> = new Map();
	discordLinks: Map<string, DiscordEntries> = new Map();
	query = '';
	queryInput = '';
	queryChoice = '';
	rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	openOrScrape = '';
	provider = new providers.JsonRpcProvider(process.env.ETH_ENDPOINT);

	constructor({ accessToken, accessSecret, appKey, appSecret }: Tokens) {
		super({ accessToken, accessSecret, appKey, appSecret });
	}

	fetchFile<T>(name: string) {
		return new Map<string, T>(
			fs.existsSync(`./export/${name}.json`)
				? Object.entries(
						JSON.parse(fs.readFileSync(`./export/${name}.json`, 'utf8') || '{}')
				  )
				: Object.entries({})
		);
	}

	saveFile(data: Map<string, any>, name: string) {
		fs.writeFile(
			`./export/${name}.json`,
			JSON.stringify(Object.fromEntries(data)),
			(err) => {
				if (err) throw err;
				console.log(`${data.size} entries saved to /export/${name}.json`);
			}
		);
	}

	saveAllFiles() {
		this.saveFile(this.ensNames, 'ensNames');
		this.saveFile(this.ethAddresses, 'ethAddresses');
		this.saveFile(this.discordLinks, 'discordLinks');
	}

	async start() {
		try {
			// Make 'export' directory if it doesn't exist
			!fs.existsSync('./export') && fs.mkdirSync('./export');

			this.ensNames = this.fetchFile('ensNames');
			this.ethAddresses = this.fetchFile('ethAddresses');
			this.discordLinks = this.fetchFile('discordLinks');

			await this.appLogin();
			console.log('Logged in');

			try {
				const choice = await this.prompt(
					'\n1. Open discord URLs\n2. Scrape Twitter\n3. Filter Addresses\nChoose number: '
				);
				if (choice == '1') return await this.openLinks();
				if (choice == '3') return await this.filterAddresses();

				await this.searchQuery();
			} catch (e) {
				console.error('Unable to get tweet: ', e);
			}
		} catch (error) {
			console.log('Login failed: ', error);
		}
	}

	async searchQuery() {
		while (true) {
			console.log(`${this.discordLinks.size} Total Discord URLs`);
			console.log(`${this.ethAddresses.size} Total ETH Addresses`);
			console.log(`${this.ensNames.size} Total ENS Names`);
			this.queryInput = await this.prompt(
				'\nEnter content or URL (q to exit) (s to save)\n->: '
			);
			if (this.queryInput == 'q' || this.queryInput == 's') {
				break;
			}
			if (this.query == '2') {
				await this.v2
					.singleTweet(this.queryInput.split('status/')?.[1] ?? '', {
						'tweet.fields': ['author_id', 'conversation_id']
					})
					.then(async (tweet) => {
						tweet.data.conversation_id &&
							(await this.getReplies(tweet.data.conversation_id, 1));
					})
					.catch((err) => console.log(err));
			} else {
				await this.v2
					.search(this.queryInput, {
						max_results: 10,
						'tweet.fields': ['conversation_id']
					})
					.then(async (tweets) => {
						tweets.tweets.forEach(async (twit) => {
							twit.conversation_id &&
								(await this.getReplies(twit.conversation_id, 1));
						});
					})
					.catch((err: ApiResponseError) =>
						console.log(
							`Error fetching tweets: ${err.data?.title}\nCode: ${err.code}\n`
						)
					);
			}
		}
		this.saveAllFiles();
		if (this.queryInput == 's') await this.searchQuery();
	}

	async getReplies(conversationId: string, page: number, next?: string) {
		await this.v2
			.get<Tweetv2TimelineResult>('tweets/search/recent', {
				query: `conversation_id: ${conversationId}`,
				expansions: ['author_id'],
				next_token: next
			})
			.then(async (replies) => {
				if (replies.meta.result_count === 0) {
					return; //No replies found in the last 7 days
				}

				replies.data.forEach(async (reply) => {
					const discordURL = reply.text.match(/discord.gg\/[a-fA-F0-9]/)?.[0];
					const ethAddress = reply.text.match(/0x[a-fA-F0-9]{40}/)?.[0];
					const ensAddress = reply.text
						.toLowerCase()
						.match(/.+?(?=\.eth)/)?.[0];

					discordURL &&
						!this.discordLinks.has(discordURL) &&
						this.discordLinks.set(discordURL, {
							opened: false,
							userId: reply.author_id ?? 'NA'
						});

					ethAddress &&
						this.ethAddresses.set(ethAddress, {
							userId: reply.author_id ?? 'NA',
							balance: +utils.formatEther(
								await this.provider.getBalance(ethAddress)
							)
						});

					ensAddress &&
						this.ensNames.set(ensAddress, {
							userId: reply.author_id ?? 'NA',
							balance: +utils.formatEther(
								await this.provider.getBalance(ensAddress)
							)
						});
				});
				// Check if there are more replies to loop through
				replies.data.length === 10 &&
					(await this.getReplies(
						conversationId,
						page + 1,
						replies.meta.next_token
					));
			})
			.catch((err: ApiResponseError) =>
				console.log(
					`Error fetching tweets: ${err.data?.title}\nCode: ${err.code}\n`
				)
			);
	}

	prompt(query: string) {
		return new Promise<string>((resolve) => this.rl.question(query, resolve));
	}

	async openLinks() {
		try {
			this.discordLinks.forEach(async (data, link) => {
				if (
					(await this.prompt('Press enter to open the next link, q to quit')) ==
					'q'
				)
					throw new Error('');

				await open(link);
				this.discordLinks.set(link, { opened: true, userId: data.userId });
			});
			console.log('All links opened');
		} catch (err) {
			console.log('Finished opening links');
		}
	}

	async filterAddresses() {
		const minBalance = +(await this.prompt('Minimum ETH balance: '));
		this.ethAddresses.forEach((addressEntry, address) => {
			addressEntry.balance >= minBalance;
			this.filteredAddresses.set(address, addressEntry);
		});
		this.saveFile(this.filteredAddresses, 'filteredAddresses');
	}
}
