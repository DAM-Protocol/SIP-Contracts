// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperApp.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./dHedgeCore.sol";

// solhint-disable var-name-mixedcase
// solhint-disable-next-line contract-name-camelcase
contract dHedgeCoreFactory is Ownable {
    ISuperfluid private constant HOST =
        ISuperfluid(0x3E14dC1b13c488a8d5D310918780c983bD5982E7);

    address public immutable implementation;

    /// @notice The DAO which receives fees
    address public dao;

    /// @notice Fee rate for collecting streaming fees scaled to 1e6
    uint32 public defaultFeeRate;

    /// @custom:note CONFIG_WORD is used to omit the specific agreement hooks of superapps (NOOP - Not Operate)
    uint256 private immutable CONFIG_WORD = 1; // 1 << 0 == 1

    /// @notice Mapping containing core address for every dHEDGE pool if deployed/created
    mapping(address => address) public cores;

    constructor(address _dao, uint32 _defaultFeeRate) {
        implementation = address(new dHedgeCore());
        defaultFeeRate = _defaultFeeRate;
        dao = _dao;
    }

    /// @dev Sets fee rate for all cores
    /// @param _defaultFeeRate The new fee rate scaled to 1e6
    function setDefaultFeeRate(uint32 _defaultFeeRate) external onlyOwner {
        defaultFeeRate = _defaultFeeRate;
    }

    function setDAOAddress(address _dao) external onlyOwner {
        dao = _dao;
    }

    /// @notice Creates a new core for a given dHEDGE pool
    /// @param _dHedgePool Address of the dHEDGE pool for which a core needs to be created
    /// @param _DHPTx Supertoken of the corresponding DHPT of `_dHedgePool`
    function createdHedgeCore(address _dHedgePool, ISuperToken _DHPTx)
        external
    {
        require(cores[_dHedgePool] == address(0), "Core already exists");

        address newCore = Clones.clone(implementation);

        dHedgeCore(newCore).initialize(_dHedgePool, _DHPTx);

        HOST.registerAppByFactory(ISuperApp(newCore), CONFIG_WORD);

        cores[_dHedgePool] = newCore;
    }
}
