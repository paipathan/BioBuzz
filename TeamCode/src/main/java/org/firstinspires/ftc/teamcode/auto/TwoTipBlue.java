package org.firstinspires.ftc.teamcode.auto;

import org.firstinspires.ftc.teamcode.Robot;
import org.firstinspires.ftc.teamcode.util.Alliance;

import dev.nextftc.robot.opmode.NextAutonomous;

@NextAutonomous(name = "Two Tip Blue", preselectTeleop = "Blue Teleop")
public class TwoTipBlue extends TwoTip {
    public TwoTipBlue(Robot robot) {
        super(robot, Alliance.BLUE);
    }
}
