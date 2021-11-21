// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

interface IPoolLogic {
    /// @notice Deposit funds into the pool
    /// @param _asset Address of the token
    /// @param _amount Amount of tokens to deposit
    /// @return liquidityMinted Amount of liquidity minted
    function deposit(address _asset, uint256 _amount)
        external
        returns (uint256 liquidityMinted);

    /// @notice Withdraw assets based on the fund token amount
    /// @param _fundTokenAmount the fund token amount
    function withdraw(uint256 _fundTokenAmount) external;

    /// @notice Get price of the asset
    /// @param price A price of the asset
    function tokenPrice() external view returns (uint256 price);

    /// @notice Get fund summary of the pool
    /// @return Name of the pool
    /// @return Total supply of the pool
    /// @return Total fund value of the pool
    /// @return Address of the pool manager
    /// @return Name of the pool manager
    /// @return Time of the pool creation
    /// @return True if the pool is private, false otherwise
    /// @return Numberator of the manager fee
    /// @return Denominator of the manager fee
    function getFundSummary()
        external
        view
        returns (
            string memory,
            uint256,
            uint256,
            address,
            string memory,
            uint256,
            bool,
            uint256,
            uint256,
            uint256,
            uint256
        );

    /// @notice Pool manager logic address for a pool
    function poolManagerLogic() external view returns (address);

    /// @notice Get exit remaining time of the pool
    /// @return remaining The remaining exit time of the pool
    function getExitRemainingCooldown(address sender)
        external
        view
        returns (uint256 remaining);
}

interface IPoolManagerLogic {
    struct Asset {
        address asset;
        bool isDeposit;
    }

    /// @notice Get all the supported assets
    /// @return Return array of supported assets
    function getSupportedAssets() external view returns (Asset[] memory);

    /// @notice Get all the deposit assets
    /// @return Return array of deposit assets' addresses
    function getDepositAssets() external view returns (address[] memory);

    /// @notice Return true if it's supported asset, false otherwise
    /// @param asset address of the asset
    function isSupportedAsset(address asset) external view returns (bool);

    /// @notice Return true if it's deposit asset, false otherwise
    /// @param asset address of the asset
    function isDepositAsset(address asset) external view returns (bool);
}
