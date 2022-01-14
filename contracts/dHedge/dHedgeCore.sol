// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import {ISuperfluid, ISuperToken, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {IInstantDistributionAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IInstantDistributionAgreementV1.sol";
import {SuperAppBase} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./Libraries/dHedgeHelper.sol";
import "./Libraries/dHedgeStorage.sol";
import "hardhat/console.sol";

/**
 * @title Core contract for a dHedge pool
 * @author rashtrakoff
 * @notice Contains user facing functions
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
// solhint-disable reason-string
// solhint-disable var-name-mixedcase
// solhint-disable-next-line contract-name-camelcase
contract dHedgeCore is Ownable, SuperAppBase {
    using SafeERC20 for IERC20;
    using dHedgeHelper for dHedgeStorage.dHedgePool;
    using SFHelper for ISuperToken;

    dHedgeStorage.dHedgePool private poolData;

    constructor(
        address _dHedgePool,
        ISuperToken _DHPTx,
        uint32 _feeRate,
        string memory _regKey
    ) {
        poolData.isActive = true;
        poolData.DHPTx = _DHPTx;
        poolData.poolLogic = _dHedgePool;
        poolData.feeRate = _feeRate;

        // NOTE: configword is used to omit the specific agreement hooks (NOOP - Not Operate)
        uint256 _configWord = SuperAppDefinitions.APP_LEVEL_FINAL;

        (bytes(_regKey).length == 0)
            ? SFHelper.HOST.registerApp(_configWord)
            : SFHelper.HOST.registerAppWithKey(_configWord, _regKey);
    }

    /**************************************************************************
     * Core functions
     *************************************************************************/

    function addSuperTokenAndIndex(ISuperToken _superToken) external onlyOwner {
        address _underlyingToken = _superToken.getUnderlyingToken();
        dHedgeStorage.TokenData storage tokenData = poolData.tokenData[
            _underlyingToken
        ];

        require(
            address(tokenData.superToken) == address(0),
            "dHedgeCore: Supertoken already mapped"
        );

        tokenData.superToken = _superToken;
        tokenData.distIndex = poolData.latestDistIndex++;

        poolData.DHPTx.createIndex(tokenData.distIndex);

        console.log("Index created");

        IERC20(_underlyingToken).safeIncreaseAllowance(
            poolData.poolLogic,
            type(uint256).max
        );

        IERC20(_underlyingToken).safeIncreaseAllowance(
            address(poolData.DHPTx),
            type(uint256).max
        );
    }

    /// @notice Converts supertokens to underlying tokens and deposits them into dHedge pool
    /// @param _token Address of the underlying token to be deposited into dHedge pool
    function dHedgeDeposit(address _token) external {
        _onlyActive();
        poolData.deposit(_token);
    }

    /// @dev Function to withdraw a token in case of emergency
    /// @param _token Address of the pool token
    /// @custom:note Remove/Modify this function after testing
    function emergencyWithdraw(address _token) external {
        _onlyOwner(msg.sender);
        IERC20(_token).safeTransfer(
            owner(),
            IERC20(_token).balanceOf(address(this))
        );
    }

    /// @dev Deactivates a dHedgeCore contract
    function deactivateCore() external {
        _onlyOwner(msg.sender);
        _onlyActive();

        poolData.isActive = false;
    }

    function reactivateCore() external {
        _onlyOwner(msg.sender);
        require(!poolData.isActive, "dHedgeCore: Pool already active");

        poolData.isActive = true;
    }

    /// @notice Calculates uninvested token amount of a particular user
    /// @param _user Address of the user whose uninvested amount needs to be calculated
    /// @param _token Address of the underlying token
    /// @return Amount of uninvested tokens
    function calcUserUninvested(address _user, address _token)
        external
        view
        returns (uint256)
    {
        return poolData.calcUserUninvested(_user, _token);
    }

    /// @notice Checks if the core is active or not
    /// @return Boolean indicating working status of core
    function checkCoreActive() external view returns (bool) {
        return poolData.isActive;
    }

    /// @notice Gets pool address
    /// @return Returns address of the dHedge pool this core contract serves
    function getPoolLogic() external view returns (address) {
        return poolData.poolLogic;
    }

    /// @dev Checks if deposit action can be performed
    /// @return Boolean indicating if upkeep/deposit can be performed
    function requireUpkeep() public view returns (bool, address) {
        _onlyActive();
        return poolData.requireUpkeep();
    }

    /// @dev Helper function that's called after agreements are created, updated or terminated
    /// @param _cbdata Callback data we passed before agreement was created, updated or terminated
    /// @param _underlyingToken Address of the underlying token on which operations need to be performed
    function _afterAgreement(
        bytes memory _ctx,
        bytes memory _cbdata,
        address _underlyingToken
    ) internal returns (bytes memory _newCtx) {
        address _sender = SFHelper.HOST.decodeCtx(_ctx).msgSender;
        uint256 _userUninvested = abi.decode(_cbdata, (uint256));
        dHedgeStorage.TokenData storage tokenData = poolData.tokenData[
            _underlyingToken
        ];

        _newCtx = tokenData.superToken.updateShares(
            poolData.DHPTx,
            tokenData.distIndex,
            _ctx
        );

        assert(
            _userUninvested <= tokenData.superToken.balanceOf(address(this))
        );

        require(
            tokenData.superToken.transfer(_sender, _userUninvested),
            "dHedgeHCore: Uninvested amount transfer failed"
        );
    }

    /// @dev Helper function that's called before agreements are created, updated or terminated
    /// @param _ctx Context data of a user provided by SF contract
    /// @param _underlyingToken Address of the underlying token on which operations need to be performed
    /// @return _cbdata Callback data that needs to be passed on to _afterAgreement function
    function _beforeAgreement(bytes memory _ctx, address _underlyingToken)
        internal
        view
        returns (bytes memory _cbdata)
    {
        address _sender = SFHelper.HOST.decodeCtx(_ctx).msgSender;

        _cbdata = abi.encode(
            poolData.calcUserUninvested(_sender, _underlyingToken)
        );
    }

    /// @dev Checks status of the core and reverts if inactive
    function _onlyActive() internal view {
        require(poolData.isActive, "dHedgeCore: Pool inactive");
    }

    /// @dev Equivalent to onlyOwner modifier
    function _onlyOwner(address _user) internal view {
        require(_user == owner(), "dHedgeCore: Not the owner");
    }

    /// @dev Checks if the caller is the SF host contract
    function _onlyHost() internal view {
        require(
            msg.sender == address(SFHelper.HOST),
            "dHedgeCore: Supports only one host"
        );
    }

    /// @dev Checks if the agreement is of type CFA
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

        console.log("Entered beforeAgreementCreated");

        address _underlyingToken = _superToken.getUnderlyingToken();
        ISuperToken _superStreamToken = poolData
            .tokenData[_underlyingToken]
            .superToken;

        require(
            address(_superStreamToken) == address(0) ||
                _superStreamToken == _superToken,
            "dHedgeCore: Supertoken not supported"
        );
        require(
            poolData.isDepositAsset(_underlyingToken),
            "dHedgeCore: Not deposit asset"
        );

        _cbdata = new bytes(0);

        console.log("Exited beforeAgreementCreated");
    }

    function afterAgreementCreated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, // _agreementId,
        bytes calldata, // _agreementData,
        bytes calldata, // _cbdata,
        bytes calldata _ctx
    ) external override returns (bytes memory _newCtx) {
        _onlyHost();
        _onlyExpected(_agreementClass);

        console.log("Entered afterAgreementCreated");

        address _underlyingToken = _superToken.getUnderlyingToken();
        dHedgeStorage.TokenData storage tokenData = poolData.tokenData[
            _underlyingToken
        ];
        /* 
            Check if the underlying token is enabled as deposit asset. If not, 
            revert the transaction as the tokens can't be deposited into the pool.
            If yes:
                Map supertoken to the underlying token.
                Unlimited approve underlying token to the dHedge pool.
            Confirm whether unlimited approve can be misused by the poolLogic contract.
        */
        if (address(tokenData.superToken) == address(0)) {
            console.log("Entered supertoken mapping");

            tokenData.superToken = _superToken;
            tokenData.distIndex = poolData.latestDistIndex++;

            poolData.DHPTx.createIndexInCallback(tokenData.distIndex, _ctx);

            console.log("Index created");

            IERC20(_underlyingToken).safeIncreaseAllowance(
                poolData.poolLogic,
                type(uint256).max
            );

            IERC20(_underlyingToken).safeIncreaseAllowance(
                address(poolData.DHPTx),
                type(uint256).max
            );
        }

        console.log("Exited supertoken mapping");

        _newCtx = _superToken.updateShares(
            poolData.DHPTx,
            tokenData.distIndex,
            _ctx
        );

        console.log("Exited afterAgreementCreated");
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

        _cbdata = _beforeAgreement(_ctx, _superToken.getUnderlyingToken());
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

        _newCtx = _afterAgreement(
            _ctx,
            _cbdata,
            _superToken.getUnderlyingToken()
        );
    }

    function beforeAgreementTerminated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, /*agreementId*/
        bytes calldata, /*agreementData*/
        bytes calldata _ctx
    ) external view override returns (bytes memory _cbdata) {
        _onlyHost();
        _onlyExpected(_agreementClass);

        _cbdata = _beforeAgreement(_ctx, _superToken.getUnderlyingToken());
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
        _onlyExpected(_agreementClass);

        _newCtx = _afterAgreement(
            _ctx,
            _cbdata,
            _superToken.getUnderlyingToken()
        );
    }
}
