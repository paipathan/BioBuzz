package org.firstinspires.ftc.teamcode.teleop;

import org.firstinspires.ftc.teamcode.Robot;
import org.firstinspires.ftc.teamcode.util.Alliance;

import dev.nextftc.robot.opmode.NextTeleop;

@NextTeleop(name = "Blue Teleop")
public class Blue extends NextTele {
    public Blue(Robot robot) {
        super(robot, Alliance.BLUE);
    }
}
