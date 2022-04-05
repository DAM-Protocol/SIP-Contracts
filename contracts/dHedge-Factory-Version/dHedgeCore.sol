// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import { ISuperfluid, ISuperToken, ISuperAgreement, SuperAppDefinitions } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import { IConstantFlowAgreementV1 } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import { IInstantDistributionAgreementV1 } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IInstantDistributionAgreementV1.sol";
import { SuperAppBase } from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./Libraries/dHedgeHelper.sol";
import "./Libraries/dHedgeStorage.sol";
import "./Interfaces/IdHedgeCore.sol";
import "./Interfaces/IdHedgeCoreFactory.sol";

import "hardhat/console.sol";

/**
 * @title Core contract for streaming into a dHedge pool
 * @author rashtrakoff <rashtrakoff@pm.me>
 * @notice Contains user facing functions
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
// solhint-disable not-rely-on-time
// solhint-disable reason-string
// solhint-disable var-name-mixedcase
// solhint-disable-next-line contract-name-camelcase
contract dHedgeCore is Initializable, SuperAppBase, IdHedgeCore {
    using SafeERC20 for IERC20;
    using dHedgeHelper for dHedgeStorage.dHedgePool;
    using SFHelper for ISuperToken;

    // Struct containing all the relevant data regarding the dHedgePool this dHedgeCore serves
    dHedgeStorage.dHedgePool private poolData;

    /// @dev Initialize the factory
    /// @param _dHedgePool dHEDGE pool contract address
    /// @param _DHPTx Supertoken corresponding to the DHPT of the pool
    function initialize(address _dHedgePool, ISuperToken _DHPTx)
        external
        initializer
    {
        poolData.isActive = true;
        poolData.factory = msg.sender;
        poolData.DHPTx = _DHPTx;
        poolData.poolLogic = _dHedgePool;
        poolData.latestDistIndex = 1;

        IERC20(_dHedgePool).safeIncreaseAllowance(
            address(_DHPTx),
            type(uint256).max
        );
    }

    /**************************************************************************
     * Core functions
     *************************************************************************/

    function initStreamToken(ISuperToken _superToken) external {
        _onlyActive();
        poolData.initStreamToken(_superToken);
    }

    /// @notice Converts supertokens to underlying tokens and deposits them into dHedge pool
    /// @param _token Address of the underlying token to be deposited into dHedge pool
    function dHedgeDeposit(address _token) external override {
        _onlyActive();
        poolData.deposit(_token);
    }

    function distribute(address _token) external {
        _onlyActive();
        poolData.distribute(_token);
    }

    /// @dev Function to withdraw a token in case of emergency
    /// @param _token Address of the pool token
    /// @custom:note Remove/Modify this function after testing
    function emergencyWithdraw(address _token) external {
        _onlyOwner(msg.sender);
        IERC20(_token).safeTransfer(
            IdHedgeCoreFactory(poolData.factory).dao(),
            IERC20(_token).balanceOf(address(this))
        );

        emit EmergencyWithdraw(_token);
    }

    /// @dev Deactivates a dHedgeCore contract
    function deactivateCore(string calldata _message) external {
        _onlyOwner(msg.sender);
        _onlyActive();

        poolData.isActive = false;

        emit CoreDeactivated(_message);
    }

    /// @dev Reactivates a dHedgeCore contract
    function reactivateCore(string calldata _message) external {
        _onlyOwner(msg.sender);
        require(!poolData.isActive, "dHedgeCore: Pool already active");

        poolData.isActive = true;

        emit CoreReactivated(_message);
    }

    /// @notice Closes a supertoken stream if core is jailed or user is running low on balance
    /// @param _superToken Supertoken being streamed
    /// @param _user Address of the user whose stream needs to be closed
    /// @dev Any user's stream can be closed by anyone provided the app is jailed
    /// or user doesn't have enough amount to stream for more than 12 hours
    function emergencyCloseStream(ISuperToken _superToken, address _user)
        external
        override
    {
        _superToken.emergencyCloseStream(_user);
    }

    /// @notice Checks if the core is active or not
    /// @return Boolean indicating working status of core
    function checkCoreActive() external view override returns (bool) {
        return poolData.isActive;
    }

    /// @dev Gets the latest distribution index created
    /// @return Number corresponding to the latest created index
    /// This function can also be used to get number of tokens supported by this dHedgeCore
    function getLatestDistIndex() external view override returns (uint32) {
        return poolData.latestDistIndex;
    }

    /// @dev Gets the distribution indices corresponding to an underlying token.
    /// @param _token Address of a deposit token.
    /// @return Index ID of first permanent index.
    /// @return Index ID of second permanent index.
    /// @return Index ID of temporary index.
    function getTokenDistIndices(address _token)
        external
        view
        override
        returns (
            uint32,
            uint32,
            uint32,
            uint32
        )
    {
        dHedgeStorage.TokenData storage tokenData = poolData.tokenData[_token];
        if (address(tokenData.superToken) != address(0))
            return (
                tokenData.permDistIndex1.indexId,
                tokenData.permDistIndex2.indexId,
                tokenData.tempDistIndex,
                tokenData.lockedIndexId
            );

        return (0, 0, 0, 0);
    }

    function getUserDistIndex(address _user, address _token)
        external
        view
        returns (uint32)
    {
        return poolData.tokenData[_token].assignedIndex[_user];
    }

    /// @notice Calculates uninvested token amount of a particular user
    /// @param _user Address of the user whose uninvested amount needs to be calculated
    /// @param _token Address of the underlying token
    /// @return Amount of uninvested tokens
    function calcUserUninvested(address _user, address _token)
        public
        view
        override
        returns (uint256)
    {
        return poolData.calcUserUninvested(_user, _token);
    }

    /// @dev Checks if deposit action can be performed
    /// @return Boolean indicating if upkeep/deposit can be performed
    /// @return Address of the underlying/deposit token which needs to be deposited to the dHedge pool
    function requireUpkeep() public view override returns (bool, address) {
        return poolData.requireUpkeep();
    }

    /// @dev Checks status of the core and reverts if inactive
    function _onlyActive() internal view {
        require(poolData.isActive, "dHedgeCore: Pool inactive");
    }

    /// @dev Equivalent to onlyOwner modifier
    function _onlyOwner(address _user) internal view {
        require(
            _user == Ownable(poolData.factory).owner(),
            "dHedgeCore: Not the owner"
        );
    }

    /// @dev Checks if the caller is the SF host contract
    function _onlyHost() internal view {
        require(
            msg.sender == address(SFHelper.HOST),
            "dHedgeCore: Supports only one host"
        );
    }

    /// @dev Checks if the agreement is of type CFA or IDA
    function _onlyExpected(address _agreementClass) internal view {
        require(
            ISuperAgreement(_agreementClass).agreementType() ==
                keccak256(
                    "org.superfluid-finance.agreements.ConstantFlowAgreement.v1"
                ) ||
                ISuperAgreement(_agreementClass).agreementType() ==
                keccak256(
                    "org.superfluid-finance.agreements.InstantDistributionAgreement.v1"
                ),
            "dHedgeCore: Callback called illegaly"
        );
    }

    /**************************************************************************
     * SuperApp callbacks
     *************************************************************************/
    /// @dev Maybe use `_beforeAgreement` hook here ?
    function beforeAgreementCreated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, /*agreementId*/
        bytes calldata, /*agreementData*/
        bytes calldata // _ctx
    ) external view override returns (bytes memory _cbdata) {
        _onlyHost();
        _onlyExpected(_agreementClass);
        _onlyActive();

        address _underlyingToken = _superToken.getUnderlyingToken();
        ISuperToken _superStreamToken = poolData
            .tokenData[_underlyingToken]
            .superToken;

        require(
            _superStreamToken == _superToken,
            "dHedgeCore: Supertoken not supported"
        );

        _cbdata = abi.encode(0);
    }

    /// @dev Maybe use `_afterAgreement` hook here ?
    function afterAgreementCreated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, // _agreementId,
        bytes calldata, // _agreementData,
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override returns (bytes memory _newCtx) {
        _onlyHost();
        _onlyExpected(_agreementClass);
        _newCtx = _ctx;

        address _user = SFHelper.HOST.decodeCtx(_newCtx).msgSender;

        _newCtx = poolData.afterAgreement(
            _user,
            _agreementClass,
            _superToken.getUnderlyingToken(),
            _newCtx,
            _cbdata
        );

        emit StreamModified(_superToken, _user);
    }

    function beforeAgreementUpdated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, /*agreementId*/
        bytes calldata, /*agreementData*/
        bytes calldata _ctx
    ) external view override returns (bytes memory _cbdata) {
        _onlyHost();
        _onlyExpected(_agreementClass);
        _onlyActive();

        _cbdata = poolData.beforeAgreement(
            _agreementClass,
            _superToken.getUnderlyingToken(),
            _ctx
        );
    }

    function afterAgreementUpdated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, //_agreementId,
        bytes calldata, //_agreementData,
        bytes calldata _cbdata, //_cbdata,
        bytes calldata _ctx
    ) external override returns (bytes memory _newCtx) {
        _onlyHost();
        _onlyExpected(_agreementClass);
        _newCtx = _ctx;

        address _user = SFHelper.HOST.decodeCtx(_newCtx).msgSender;

        _newCtx = poolData.afterAgreement(
            _user,
            _agreementClass,
            _superToken.getUnderlyingToken(),
            _newCtx,
            _cbdata
        );

        emit StreamModified(_superToken, _user);
    }

    function beforeAgreementTerminated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, /*agreementId*/
        bytes calldata, /*agreementData*/
        bytes calldata _ctx
    ) external view override returns (bytes memory _cbdata) {
        _onlyHost();

        try
            poolData.beforeAgreement(
                _agreementClass,
                _superToken.getUnderlyingToken(),
                _ctx
            )
        returns (bytes memory _newCbData) {
            _cbdata = _newCbData;
        } catch (bytes memory _error) {
            console.logBytes(_error);
            _cbdata = new bytes(0);
        }
    }

    function afterAgreementTerminated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, //_agreementId,
        bytes calldata, // _agreementData,
        bytes calldata _cbdata, //_cbdata,
        bytes calldata _ctx
    ) external override returns (bytes memory _newCtx) {
        _onlyHost();
        _newCtx = _ctx;

        address _user = SFHelper.HOST.decodeCtx(_newCtx).msgSender;

        try
            poolData.afterAgreement(
                _user,
                _agreementClass,
                _superToken.getUnderlyingToken(),
                _newCtx,
                _cbdata
            )
        returns (bytes memory _modCtx) {
            _newCtx = _modCtx;
        } catch (bytes memory _error) {
            console.log("Reverted");
            console.logBytes(_error);
        }

        emit StreamModified(_superToken, _user);
    }
}
