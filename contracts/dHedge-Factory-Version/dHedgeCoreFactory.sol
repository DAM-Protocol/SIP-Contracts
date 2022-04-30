// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.10;

import "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperApp.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./Interfaces/IdHedgeCoreFactory.sol";
import "./dHedgeCore.sol";

/**
 * @title dHedge core factory.
 * @author rashtrakoff <rashtrakoff@pm.me>.
 * @notice Contract to create new cores easily.
 * @dev Some variables necessary/common for all cores are stored here.
 * These variables are referred in the cores.
 */
// solhint-disable var-name-mixedcase
// solhint-disable-next-line contract-name-camelcase
contract dHedgeCoreFactory is IdHedgeCoreFactory, Ownable {
    address public implementation;

    /// @notice The DAO which receives fees.
    address public override dao;

    /// @notice Fee rate for collecting streaming fees scaled to 1e6.
    uint32 public override defaultFeeRate;

    /// @custom:note CONFIG_WORD is used to omit the specific agreement hooks of superapps (NOOP - Not Operate).
    uint256 private immutable CONFIG_WORD = 1; // 1 << 0 == 1

    /// @notice Mapping containing core address for every dHEDGE pool if deployed/created.
    mapping(address => address) public cores;

    constructor(address _dao, uint32 _defaultFeeRate) {
        require(_dao != address(0), "DAO address null");

        implementation = address(new dHedgeCore());
        dao = _dao;
        defaultFeeRate = _defaultFeeRate;
    }

    /// @dev Sets a new implementation of core contract.
    /// @dev Only to be used in case of an issue with existing/default implementation. Must be removed after testing.
    function setImplementation(
        address _implementation,
        string calldata _message
    ) external onlyOwner {
        require(_implementation != address(0), "Implementation address null");
        implementation = _implementation;

        emit ImplementationChanged(_implementation, _message);
    }

    /// @dev Sets fee rate for all cores.
    /// @param _defaultFeeRate The new fee rate scaled to 1e6.
    function setDefaultFeeRate(uint32 _defaultFeeRate) external onlyOwner {
        defaultFeeRate = _defaultFeeRate;

        emit FeeRateChanged(_defaultFeeRate);
    }

    /// @dev Sets DAO address for all cores.
    /// @param _dao New address for the DAO.
    function setDAOAddress(address _dao) external onlyOwner {
        require(_dao != address(0), "DAO address null");
        dao = _dao;

        emit DAOAddressChanged(_dao);
    }

    /// @notice Creates a new core for a given dHEDGE pool.
    /// @param _dHedgePool Address of the dHEDGE pool for which a core needs to be created.
    /// @param _DHPTx Supertoken of the corresponding DHPT of `_dHedgePool`.
    function createdHedgeCore(address _dHedgePool, ISuperToken _DHPTx)
        external
    {
        require(cores[_dHedgePool] == address(0), "Core already exists");

        _createCore(_dHedgePool, _DHPTx);
    }

    function replacedHedgeCore(address _dHedgePool, ISuperToken _DHPTx)
        external
        onlyOwner
    {
        require(cores[_dHedgePool] != address(0), "Core doesn't exist");

        _createCore(_dHedgePool, _DHPTx);
    }

    function _createCore(address _dHedgePool, ISuperToken _DHPTx) internal {
        address newCore = Clones.clone(implementation);

        dHedgeCore(newCore).initialize(_dHedgePool, _DHPTx);

        SFHelper.HOST.registerAppByFactory(ISuperApp(newCore), CONFIG_WORD);

        cores[_dHedgePool] = newCore;

        emit CoreCreated(newCore, _dHedgePool, address(_DHPTx));
    }
}
