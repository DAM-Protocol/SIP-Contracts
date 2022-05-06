// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.10;

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
 * @title Core contract for streaming into a dHedge pool.
 * @author rashtrakoff <rashtrakoff@pm.me>.
 * @notice Contains user facing functions.
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

    // Struct containing all the relevant data regarding the dHedgePool this dHedgeCore serves.
    dHedgeStorage.dHedgePool private poolData;

    /// @dev Initialize the factory.
    /// @param _dHedgePool dHEDGE pool contract address.
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

    /// Initialises an underlying token and it's supertoken for streaming into dHEDGE pool.
    /// @param _superToken Supertoken of the underlying token we wish to stream.
    function initStreamToken(ISuperToken _superToken) external {
        _onlyActive();
        _onlyOwner(msg.sender);
        poolData.initStreamToken(_superToken);
    }

    /// Converts supertokens to underlying tokens and deposits them into dHedge pool.
    /// @param _underlyingToken Address of the underlying token to be deposited into dHedge pool.
    function dHedgeDeposit(address _underlyingToken) external override {
        _onlyActive();
        poolData.deposit(_underlyingToken);
    }

    /// Distributes the DHPTx corresponding to a underlying token's deposits.
    /// @param _underlyingToken Address of the underlying token.
    function distribute(address _underlyingToken) external {
        _onlyActive();
        poolData.distribute(_underlyingToken);
    }

    /// Function to withdraw a token in case of emergency.
    /// @param _token Address of any token in this contract.
    /// @dev TODO Remove/Modify this function after testing
    function emergencyWithdraw(address _token) external {
        _onlyOwner(msg.sender);
        IERC20(_token).safeTransfer(
            IdHedgeCoreFactory(poolData.factory).dao(),
            IERC20(_token).balanceOf(address(this))
        );

        emit EmergencyWithdraw(_token);
    }

    /// Deactivates a dHedgeCore contract.
    /// @param _message Message reason for reactivation of the core.
    function deactivateCore(string calldata _message) external {
        _onlyOwner(msg.sender);
        _onlyActive();

        poolData.isActive = false;

        emit CoreDeactivated(_message);
    }

    /// Reactivates a dHedgeCore contract.
    /// @param _message Message reason for reactivation of the core.
    function reactivateCore(string calldata _message) external {
        _onlyOwner(msg.sender);
        require(!poolData.isActive, "dHedgeCore: Pool already active");

        poolData.isActive = true;

        emit CoreReactivated(_message);
    }

    /// Closes a supertoken stream if the core is jailed or user is running low on balance.
    /// Any user's stream can be closed by anyone provided the app is jailed-
    /// or user doesn't have enough amount to stream for more than 12 hours.
    /// @param _superToken Supertoken being streamed.
    /// @param _user Address of the user whose stream needs to be closed.
    function emergencyCloseStream(ISuperToken _superToken, address _user)
        external
        override
    {
        _superToken.emergencyCloseStream(_user);
    }

    /// Checks if the core is active or not.
    /// @return Boolean indicating working status of core.
    function checkCoreActive() external view override returns (bool) {
        return poolData.isActive;
    }

    /// Gets the distribution indices corresponding to an underlying token.
    /// @param _underlyingToken Address of a deposit token.
    /// @return Index ID of first permanent index.
    /// @return Index ID of second permanent index.
    /// @return Index ID of temporary index.
    /// @return Index ID of the locked index.
    function getTokenDistIndices(address _underlyingToken)
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
        dHedgeStorage.TokenData storage tokenData = poolData.tokenData[
            _underlyingToken
        ];

        if (address(tokenData.superToken) == address(0)) return (0, 0, 0, 0);

        return (
            tokenData.permDistIndex1.indexId,
            tokenData.permDistIndex2.indexId,
            tokenData.tempDistIndex,
            tokenData.lockedIndexId
        );
    }

    /// Gets a user's assigned permanent distribution index for a supertoken stream.
    /// @param _user Address of the user.
    /// @param _underlyingToken Address of the underlying token for which the permanent distribution index ID is required.
    /// @return Assigned permanent distribution index ID.
    function getUserDistIndex(address _user, address _underlyingToken)
        external
        view
        returns (uint32)
    {
        return poolData.tokenData[_underlyingToken].assignedIndex[_user];
    }

    /// Calculates uninvested token amount of a particular user.
    /// @param _user Address of the user whose uninvested amount needs to be calculated.
    /// @param _superToken Address of the supertoken.
    /// @return Amount of uninvested tokens.
    function calcUserUninvested(address _user, ISuperToken _superToken)
        public
        view
        override
        returns (uint256)
    {
        return poolData.calcUserUninvested(_user, _superToken);
    }

    /// Checks if deposit action can be performed.
    /// @return Address of the underlying/deposit token which needs to be deposited to the dHedge pool.
    function requireUpkeep() public view override returns (address) {
        return poolData.requireUpkeep();
    }

    /// Checks status of the core and reverts if inactive.
    function _onlyActive() internal view {
        require(poolData.isActive, "dHedgeCore: Pool inactive");
    }

    /// Equivalent to onlyOwner modifier.
    /// @param _user Address of the user claiming to be the owner.
    function _onlyOwner(address _user) internal view {
        require(
            _user == Ownable(poolData.factory).owner(),
            "dHedgeCore: Not the owner"
        );
    }

    /**************************************************************************
     * SuperApp callbacks
     *************************************************************************/

    /// @dev TODO Check if `_onlyExpected` is even required.
    function beforeAgreementCreated(
        ISuperToken _superToken,
        address, /*_agreementClass*/
        bytes32, /*agreementId*/
        bytes calldata, /*agreementData*/
        bytes calldata /*_ctx*/
    ) external view override returns (bytes memory _cbdata) {
        SFHelper._onlyHost();
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

    function afterAgreementCreated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, /*_agreementId*/
        bytes calldata _agreementData,
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override returns (bytes memory _newCtx) {
        SFHelper._onlyHost();
        _newCtx = _ctx;

        _newCtx = poolData.afterAgreementCreated(
            _superToken,
            _agreementClass,
            _agreementData,
            _newCtx,
            _cbdata
        );
    }

    function beforeAgreementUpdated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, /*agreementId*/
        bytes calldata _agreementData,
        bytes calldata /*_ctx*/
    ) external view override returns (bytes memory _cbdata) {
        SFHelper._onlyHost();
        _onlyActive();

        _cbdata = poolData.beforeAgreement(
            _superToken,
            _agreementClass,
            _agreementData
        );
    }

    function afterAgreementUpdated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, /*_agreementId*/
        bytes calldata _agreementData,
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override returns (bytes memory _newCtx) {
        SFHelper._onlyHost();
        _newCtx = _ctx;

        _newCtx = poolData.afterAgreementUpdated(
            _superToken,
            _agreementClass,
            _agreementData,
            _newCtx,
            _cbdata
        );
    }

    function beforeAgreementTerminated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, /*agreementId*/
        bytes calldata _agreementData,
        bytes calldata /*_ctx*/
    ) external view override returns (bytes memory _cbdata) {
        SFHelper._onlyHost();

        try
            poolData.beforeAgreement(
                _superToken,
                _agreementClass,
                _agreementData
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
        bytes calldata _agreementData,
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override returns (bytes memory _newCtx) {
        SFHelper._onlyHost();
        _newCtx = _ctx;

        try
            poolData.afterAgreementTerminated(
                _superToken,
                _agreementClass,
                _agreementData,
                _newCtx,
                _cbdata
            )
        returns (bytes memory _modCtx) {
            _newCtx = _modCtx;
        } catch (bytes memory _error) {
            // console.log("Reverted");
            console.logBytes(_error);
        }
    }
}
