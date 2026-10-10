import hre from "hardhat";

async function main() {
  const VerityJobs = await hre.ethers.getContractFactory("VerityJobs");
  const verityJobs = await VerityJobs.deploy();
  await verityJobs.waitForDeployment();

  const address = await verityJobs.getAddress();
  console.log(`VerityJobs deployed to: ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
