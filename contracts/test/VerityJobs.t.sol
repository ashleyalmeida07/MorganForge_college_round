// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/VerityJobs.sol";

contract VerityJobsTest is Test {
    VerityJobs public verityJobs;

    address public provider1 = address(1);
    address public provider2 = address(2);

    function setUp() public {
        verityJobs = new VerityJobs();
    }

    function test_RegisterProvider() public {
        vm.prank(provider1);
        verityJobs.registerProvider("https://api.provider1.com");

        VerityJobs.Provider memory p = verityJobs.getProvider(provider1);
        assertEq(p.wallet, provider1);
        assertEq(p.apiUrl, "https://api.provider1.com");
        assertTrue(p.active);
        assertEq(p.jobsCompleted, 0);
    }

    function test_UpdateProviderUrl() public {
        vm.prank(provider1);
        verityJobs.registerProvider("https://api.provider1.com");

        vm.prank(provider1);
        verityJobs.updateProviderUrl("https://new.provider1.com");

        VerityJobs.Provider memory p = verityJobs.getProvider(provider1);
        assertEq(p.apiUrl, "https://new.provider1.com");
    }

    function testFail_UnregisteredProviderCannotAcceptJob() public {
        vm.prank(provider2);
        verityJobs.acceptJob(1); // Should revert because provider2 is not registered
    }

    function test_StatsUpdateCorrectly() public {
        vm.prank(provider1);
        verityJobs.registerProvider("https://api.provider1.com");

        // Simulate finalization
        verityJobs.testFinalizeJob(provider1);
        assertEq(verityJobs.getProvider(provider1).jobsCompleted, 1);

        // Simulate challenge
        verityJobs.testChallengeProvider(provider1);
        assertEq(verityJobs.getProvider(provider1).timesChallenged, 1);

        // Simulate slash
        verityJobs.testSlashProvider(provider1);
        assertEq(verityJobs.getProvider(provider1).timesSlashed, 1);
    }
}
