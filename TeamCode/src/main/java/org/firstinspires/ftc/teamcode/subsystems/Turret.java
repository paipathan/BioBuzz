package org.firstinspires.ftc.teamcode.subsystems;

import org.firstinspires.ftc.teamcode.util.Constants;
import org.firstinspires.ftc.teamcode.util.ShotCalculator;
import org.firstinspires.ftc.teamcode.util.Utilities;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextServo;
import dev.nextftc.robot.Mechanism;
import dev.nextftc.robot.Telemetry;

public class Turret implements Mechanism {
    NextServo turretServo1 = new NextServo(RobotController.controlHub(), Constants.Turret.turretServoPort1, Constants.Turret.servoCacheTolerance);
    NextServo turretServo2 = new NextServo(RobotController.controlHub(), Constants.Turret.turretServoPort2, Constants.Turret.servoCacheTolerance);

    private double angle = 0;

    public Turret() {
        turretServo1.setDirection(Constants.Turret.turretServoDirection1);
        turretServo2.setDirection(Constants.Turret.turretServoDirection2);
    }

    public static double toPosition(double angleRadians) {
        double max = Constants.Turret.rangeDegrees / 2;
        double degrees = Utilities.clamp(Math.toDegrees(angleRadians), -max, max);
        return 0.5 - degrees / Constants.Turret.rangeDegrees;
    }

    public void updateTurret(double angleRadians) {
        angle = angleRadians;
        double position = toPosition(angleRadians);
        turretServo1.setPosition(position);
        turretServo2.setPosition(position);
    }

    @Override
    public void periodic() {
        updateTurret(ShotCalculator.turretAngle);
        Telemetry.log("turret angle (deg)", Math.toDegrees(angle));
        Telemetry.log("turret position", toPosition(angle));
        Telemetry.log("goal distance", ShotCalculator.distance);
    }
}
