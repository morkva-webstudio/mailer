import net from "node:net";

// Addresses a server must never fetch for a customer: loopback, private networks, link-local (cloud
// metadata), carrier-grade NAT, documentation, multicast and reserved ranges.
const BLOCKED = new net.BlockList();
for (const [address, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 3],
]) {
	BLOCKED.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
	["::", 128],
	["::1", 128],
	["64:ff9b::", 96],
	["100::", 64],
	["2001:db8::", 32],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
]) {
	BLOCKED.addSubnet(address, prefix, "ipv6");
}

export function isPublicAddress(address) {
	const family = net.isIP(address);
	if (family === 4) return !BLOCKED.check(address, "ipv4");
	if (family !== 6) return false;
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
	return mapped ? isPublicAddress(mapped) : !BLOCKED.check(address, "ipv6");
}
