// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import {ISuperfluid, ISuperToken, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {SuperAppBase} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";
import {FlowData} from "../Common/SFHelper.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./Libraries/dHedgeHelper.sol";
import "./Libraries/dHedgeStorage.sol";

// import "hardhat/console.sol";

/**
 * @title Core contract for a dHedge pool
 * @author rashtrakoff
 * @notice Contains user facing functions
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
// solhint-disable reason-string
// solhint-disable-next-line contract-name-camelcase
contract dHedgeCore is Ownable, SuperAppBase {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using dHedgeHelper for dHedgeStorage.dHedgePool;
    using SFHelper for *;

    address private upkeep;
    dHedgeStorage.dHedgePool private poolData;

    constructor(
        ISuperfluid _host,
        IConstantFlowAgreementV1 _cfa,
        address _dHedgePool,
        address _bank,
        string memory _regKey
    ) {
        require(
            address(_host) != address(0),
            "dHedgeCore: Host address invalid"
        );
        require(address(_cfa) != address(0), "dHedgeCore: CFA address invalid");
        require(_dHedgePool != address(0), "dHedgeCore: Pool address invalid");
        require(_bank != address(0), "dHedgeCore: Bank address invalid");

        poolData.host = _host;
        poolData.cfa = _cfa;
        poolData.poolLogic = _dHedgePool;
        poolData.bank = _bank;
        poolData.isActive = true;

        // Providing dHedgeBank with unlimited allowance for storing LP tokens
        IERC20(_dHedgePool).safeIncreaseAllowance(_bank, type(uint256).max);

        // NOTE: configword is used to omit the specific agreement hooks (NOOP - Not Operate)
        uint256 _configWord = SuperAppDefinitions.APP_LEVEL_FINAL;

        (bytes(_regKey).length == 0)
            ? poolData.host.registerApp(_configWord)
            : poolData.host.registerAppWithKey(_configWord, _regKey);
    }

    /// @dev Function to withdraw a token in case of emergency
    /// @param _token Address of the pool token
    /// Remove/Modify this function after testing
    function emergencyWithdraw(address _token) external onlyOwner {
        IERC20(_token).safeTransfer(
            owner(),
            IERC20(_token).balanceOf(address(this))
        );
    }

    /// @notice Converts supertokens to underlying tokens and deposits them into dHedge pool
    /// @param _token Address of the underlying token to be deposited into dHedge pool
    function dHedgeDeposit(address _token) external {
        _onlyActive();
        poolData.deposit(_token);
    }

    /// @notice Withdraws LP tokens of the pool to the caller
    /// @param _amount Amount of LP tokens to be withdrawn
    function dHedgeWithdraw(uint256 _amount) external {
        _onlyActive();
        poolData.withdrawLPT(_amount);
    }

    /// @notice Withdraws all the uninvested tokens of the caller
    function withdrawUninvestedAll() external {
        poolData.withdrawUninvestedAll();
    }

    /// @notice Withdraws uninvested tokens in a specific amount
    /// @param _token Address of the underlying token
    /// @param _amount Amount of uninvested token to be withdrawn
    function withdrawUninvestedSingle(address _token, uint256 _amount)
        external
    {
        poolData.withdrawUninvestedSingle(_token, _amount);
    }

    /// @dev Deactivates a dHedgeCore contract
    function deactivateCore() external onlyOwner {
        require(poolData.isActive, "dHedgeCore: Pool already inactive");
        poolData.isActive = false;
    }

    /// @dev Moves the LP tokens from core to bank. May be called iff keepers fail.
    function moveLPT() external onlyOwner {
        _onlyActive();
        poolData.moveLPT();
    }

    /// @notice Calculates withdrawable amount. Also accounts for cooldown period.
    /// @param _user Address of the user whose withdrawable amount needs to be calculated
    /// @return Amount that can be withdrawn immediately
    function calcWithdrawable(address _user) external view returns (uint256) {
        return poolData.calcWithdrawable(_user);
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
        return poolData.requireUpkeep();
    }

    /// @dev Helper function that's called after agreements are created, updated or terminated
    /// @param _cbdata Callback data we passed before agreement was created, updated or terminated
    /// @param _underlyingToken Address of the underlying token on which operations need to be performed
    function _afterAgreement(bytes memory _cbdata, address _underlyingToken)
        internal
    {
        (
            address _sender,
            uint256 _prevUninvestedSum,
            uint256 _prevShareAmount
        ) = abi.decode(_cbdata, (address, uint256, uint256));

        FlowData storage _userFlow = poolData.userFlows[_sender][
            _underlyingToken
        ];

        _userFlow._updateFlowDetails(_prevUninvestedSum, _prevShareAmount);
        _userFlow.updateIndex = poolData
            .tokenData[_underlyingToken]
            .currMarketIndex;
    }

    /// @dev Helper function that's called before agreements are created, updated or terminated
    /// @param _ctx Context data of a user provided by SF contract
    /// @param _underlyingToken Address of the underlying token on which operations need to be performed
    /// @return Callback data that needs to be passed on to _afterAgreement function
    function _beforeAgreement(bytes memory _ctx, address _underlyingToken)
        internal
        view
        returns (bytes memory)
    {
        address _sender = poolData.host.decodeCtx(_ctx).msgSender;

        return
            abi.encode(
                _sender,
                poolData.calcUserUninvested(_sender, _underlyingToken),
                poolData.calcUserShare(_sender, _underlyingToken, false)
            );
    }

    /// @dev Checks status of the core and reverts if inactive
    function _onlyActive() internal view {
        require(poolData.isActive, "dHedgeCore: Pool inactive");
    }

    function _onlyHost() internal view {
        require(
            msg.sender == address(poolData.host),
            "dHedgeCore: Supports only one host"
        );
    }

    function _onlyCFA(address _agreementClass) internal view {
        require(
            ISuperAgreement(_agreementClass).agreementType() ==
                keccak256(
                    "org.superfluid-finance.agreements.ConstantFlowAgreement.v1"
                ),
            "dHedgeCore: Supports only one CFA"
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
        bytes calldata _ctx
    ) external view override returns (bytes memory cbdata) {
        _onlyHost();
        _onlyCFA(_agreementClass);
        _onlyActive();

        address _underlyingToken = _superToken.getUnderlyingToken();

        if (!poolData.isDepositAsset(_underlyingToken)) {
            revert("Token not deposit asset");
        }

        return _beforeAgreement(_ctx, _underlyingToken);
    }

    function afterAgreementCreated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, // _agreementId,
        bytes calldata, // agreementData,
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override returns (bytes memory newCtx) {
        _onlyHost();
        _onlyCFA(_agreementClass);

        address _underlyingToken = _superToken.getUnderlyingToken();

        /* 
            Check if the underlying token is enabled as deposit asset. If not, 
            revert the transaction as the tokens can't be deposited into the pool.
            If yes: 
                Check if the asset is contained by our tokenset and add it if it isn't.
                Map supertoken to the underlying token.
                Unlimited approve underlying token to the dHedge pool.
            Confirm whether unlimited approve can be misused by the poolLogic contract.
        */
        if (poolData.tokenData[_underlyingToken].superToken == address(0)) {
            poolData.tokenSet.push(_underlyingToken);
            poolData.tokenData[_underlyingToken].superToken = address(
                _superToken
            );
            poolData.tokenData[_underlyingToken].currMarketIndex = 1;

            IERC20(_underlyingToken).safeIncreaseAllowance(
                poolData.poolLogic,
                type(uint256).max
            );
        }

        _afterAgreement(_cbdata, _underlyingToken);

        return _ctx;
    }

    function beforeAgreementUpdated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, /*agreementId*/
        bytes calldata, /*agreementData*/
        bytes calldata _ctx
    ) external view override returns (bytes memory cbdata) {
        _onlyHost();
        _onlyCFA(_agreementClass);
        _onlyActive();

        return _beforeAgreement(_ctx, _superToken.getUnderlyingToken());
    }

    function afterAgreementUpdated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, //_agreementId,
        bytes calldata, //_agreementData,
        bytes calldata _cbdata, //_cbdata,
        bytes calldata _ctx
    ) external override returns (bytes memory newCtx) {
        _onlyHost();
        _onlyCFA(_agreementClass);

        _afterAgreement(_cbdata, _superToken.getUnderlyingToken());

        return _ctx;
    }

    function beforeAgreementTerminated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, /*agreementId*/
        bytes calldata, /*agreementData*/
        bytes calldata _ctx
    ) external view override returns (bytes memory cbdata) {
        _onlyHost();
        _onlyCFA(_agreementClass);

        return _beforeAgreement(_ctx, _superToken.getUnderlyingToken());
    }

    function afterAgreementTerminated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, //_agreementId,
        bytes calldata, // _agreementData,
        bytes calldata _cbdata, //_cbdata,
        bytes calldata _ctx
    ) external override returns (bytes memory newCtx) {
        _onlyHost();
        _onlyCFA(_agreementClass);

        _afterAgreement(_cbdata, _superToken.getUnderlyingToken());

        return _ctx;
    }
}
