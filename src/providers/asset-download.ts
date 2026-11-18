import {lookup} from 'node:dns';
import {get} from 'node:https';
import {BlockList, isIP} from 'node:net';

const blocked = new BlockList();
for (const [address, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(address, bits);
const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');
for (const [address, bits] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
] as const)
  blocked.addSubnet(address, bits, 'ipv6');

function publicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address);
  return family === 6 && globalIpv6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

export const maxProviderBytes = 64 * 1024 * 1024;

export async function downloadAsset(input: string, cancellation?: AbortSignal): Promise<Buffer> {
  const timeout = AbortSignal.timeout(60_000);
  const signal = cancellation ? AbortSignal.any([timeout, cancellation]) : timeout;
  let url = new URL(input);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (url.protocol !== 'https:' || url.username || url.password || (isIP(host) && !publicAddress(host)))
      throw new Error('Provider assets require a public HTTPS address.');
    // Resolve within the socket lookup so the addresses checked here are the ones used to connect.
    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      get(
        url,
        {
          signal,
          agent: false,
          lookup(hostname, options, callback) {
            lookup(hostname, {all: true, family: options.family}, (error, addresses) => {
              if (error) return callback(error, '', 0);
              if (!addresses.length || addresses.some(({address}) => !publicAddress(address)))
                return callback(new Error('Provider asset resolved to a non-public address.'), '', 0);
              const {address, family} = addresses[0];
              if (options.all) callback(null, addresses);
              else callback(null, address, family);
            });
          },
        },
        resolve,
      ).on('error', reject);
    });
    const status = response.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
      response.destroy();
      url = new URL(response.headers.location, url);
      continue;
    }
    if (status < 200 || status >= 300) {
      response.destroy();
      throw new Error(`Could not download generated asset (HTTP ${status}).`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > maxProviderBytes) throw new Error('Generated asset exceeds 64 MB.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  }
  throw new Error('Provider asset exceeded the redirect limit.');
}
