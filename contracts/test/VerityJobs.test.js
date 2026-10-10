import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

describe("VerityJobs", function () {
  let verityJobs;
  let owner;
  let provider1;
  let provider2;

  beforeEach(async function () {
    [owner, provider1, provider2] = await ethers.getSigners();
    const VerityJobs = await ethers.getContractFactory("VerityJobs");
    verityJobs = await VerityJobs.deploy();
    await verityJobs.waitForDeployment();
  });

  it("Should register a provider", async function () {
    await verityJobs.connect(provider1).registerProvider("https://api.provider1.com");
    const p = await verityJobs.getProvider(provider1.address);
    expect(p.wallet).to.equal(provider1.address);
    expect(p.apiUrl).to.equal("https://api.provider1.com");
    expect(p.active).to.be.true;
    expect(p.jobsCompleted).to.equal(0);
  });

  it("Should update provider url", async function () {
    await verityJobs.connect(provider1).registerProvider("https://api.provider1.com");
    await verityJobs.connect(provider1).updateProviderUrl("https://new.provider1.com");
    const p = await verityJobs.getProvider(provider1.address);
    expect(p.apiUrl).to.equal("https://new.provider1.com");
  });

  it("Should prevent unregistered provider from accepting a job", async function () {
    await expect(verityJobs.connect(provider2).acceptJob(1)).to.be.revertedWith("Not registered");
  });

  it("Should update stats correctly", async function () {
    await verityJobs.connect(provider1).registerProvider("https://api.provider1.com");
    
    await verityJobs.testFinalizeJob(provider1.address);
    expect((await verityJobs.getProvider(provider1.address)).jobsCompleted).to.equal(1);

    await verityJobs.testChallengeProvider(provider1.address);
    expect((await verityJobs.getProvider(provider1.address)).timesChallenged).to.equal(1);

    await verityJobs.testSlashProvider(provider1.address);
    expect((await verityJobs.getProvider(provider1.address)).timesSlashed).to.equal(1);
  });
});
