// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract VerityJobs {
    struct Provider {
        address wallet;
        string apiUrl;
        uint256 registeredAt;
        uint256 jobsCompleted;
        uint256 timesChallenged;
        uint256 timesSlashed;
        bool active;
    }

    mapping(address => Provider) public providers;
    address[] public providerAddresses;

    event ProviderRegistered(address indexed provider, string apiUrl);
    event ProviderUpdated(address indexed provider, string apiUrl);
    event ProviderDeactivated(address indexed provider);
    event JobAccepted(uint256 indexed jobId, address indexed provider);
    
    // Stub events for Phase 1 simulation
    event JobFinalized(uint256 indexed jobId, address indexed provider);
    event ProviderChallenged(uint256 indexed jobId, address indexed provider);
    event ProviderSlashed(uint256 indexed jobId, address indexed provider);

    modifier onlyRegisteredProvider() {
        require(providers[msg.sender].wallet == msg.sender, "Not registered");
        require(providers[msg.sender].active, "Provider inactive");
        _;
    }

    function registerProvider(string memory _apiUrl) external {
        require(bytes(_apiUrl).length > 0, "Empty API URL");
        require(providers[msg.sender].wallet == address(0), "Already registered");

        providers[msg.sender] = Provider({
            wallet: msg.sender,
            apiUrl: _apiUrl,
            registeredAt: block.timestamp,
            jobsCompleted: 0,
            timesChallenged: 0,
            timesSlashed: 0,
            active: true
        });
        providerAddresses.push(msg.sender);

        emit ProviderRegistered(msg.sender, _apiUrl);
    }

    function updateProviderUrl(string memory _apiUrl) external onlyRegisteredProvider {
        require(bytes(_apiUrl).length > 0, "Empty API URL");
        providers[msg.sender].apiUrl = _apiUrl;
        emit ProviderUpdated(msg.sender, _apiUrl);
    }

    function deactivateProvider() external onlyRegisteredProvider {
        providers[msg.sender].active = false;
        emit ProviderDeactivated(msg.sender);
    }

    function getProvider(address _provider) external view returns (Provider memory) {
        return providers[_provider];
    }

    function getAllProviders() external view returns (Provider[] memory) {
        Provider[] memory allProviders = new Provider[](providerAddresses.length);
        for (uint256 i = 0; i < providerAddresses.length; i++) {
            allProviders[i] = providers[providerAddresses[i]];
        }
        return allProviders;
    }

    function acceptJob(uint256 jobId) external onlyRegisteredProvider {
        emit JobAccepted(jobId, msg.sender);
    }

    // Phase 1 testing functions for stats update
    function testFinalizeJob(address _provider) external {
        require(providers[_provider].wallet != address(0), "Provider not found");
        providers[_provider].jobsCompleted += 1;
        emit JobFinalized(0, _provider);
    }

    function testChallengeProvider(address _provider) external {
        require(providers[_provider].wallet != address(0), "Provider not found");
        providers[_provider].timesChallenged += 1;
        emit ProviderChallenged(0, _provider);
    }

    function testSlashProvider(address _provider) external {
        require(providers[_provider].wallet != address(0), "Provider not found");
        providers[_provider].timesSlashed += 1;
        emit ProviderSlashed(0, _provider);
    }
}
