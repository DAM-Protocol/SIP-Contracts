// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.10;

import {ISuperApp, ISuperfluid} from "https://github.com/superfluid-finance/protocol-monorepo/blob/0839cae1488e9db6c1eac69208bd55079dcf40c2/packages/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1, ISuperfluidToken} from "https://github.com/superfluid-finance/protocol-monorepo/blob/0839cae1488e9db6c1eac69208bd55079dcf40c2/packages/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {IERC20} from "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/c12076fb7e3dfe48ef1d9c3bb2a58bdd3ffc0cee/contracts/token/ERC20/IERC20.sol";

interface IdHedgeCore {
    function emergencyCloseStream(ISuperfluidToken _superToken, address _user) external;
}

// Contract deployed at: 0x58c3e6ede760d179826aa3407401951c8a72c40e
contract DeSIPCloseStream {
    ISuperfluid public constant HOST =
        ISuperfluid(0x3E14dC1b13c488a8d5D310918780c983bD5982E7);
    IConstantFlowAgreementV1 public constant CFA_V1 =
        IConstantFlowAgreementV1(0x6EeE6060f715257b970700bc2656De21dEdF074C);

    function executor(address _core, address _user, address _superToken) external {
        IdHedgeCore(_core).emergencyCloseStream(ISuperfluidToken(_superToken), _user);
    }

    function checker(address _core, address _user, address _superToken) external view returns(bool _canExec, bytes memory _execPayload) {
        bool _close;

        if (HOST.isAppJailed(ISuperApp(_core))) _close = true;
        else {
            int96 _flowRate = CFA_V1.getNetFlow(ISuperfluidToken(_superToken), _user);

            if (_flowRate < 0) {
                uint256 _balance = IERC20(_superToken).balanceOf(_user);
                uint256 _positiveFlowRate = uint256(uint96(-1 * _flowRate));

                // if user has less liquidity ( <= 12 hours worth) close the stream
                if (_balance <= _positiveFlowRate * 12 hours) _close = true;
            }
        }

        if(_close) {
            _canExec = true;
            _execPayload = abi.encodeWithSelector(DeSIPCloseStream.executor.selector, _core, _user, _superToken);
        }
    }
}