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

    // NOTE: CONFIG_WORD is used to omit the specific agreement hooks (NOOP - Not Operate)
    uint256 private immutable CONFIG_WORD = 1; // 1 << 0 == 1

    mapping(address => address) public cores;

    constructor() {
        implementation = address(new dHedgeCore());
    }

    function createdHedgeCore(
        address _dHedgePool,
        ISuperToken _DHPTx,
        uint32 _feeRate
    ) external {
        require(cores[_dHedgePool] == address(0), "Core already exists");

        address newCore = Clones.clone(implementation);

        dHedgeCore(newCore).initialize(_dHedgePool, _DHPTx, _feeRate);

        HOST.registerAppByFactory(ISuperApp(newCore), CONFIG_WORD);

        cores[_dHedgePool] = newCore;
    }
}
