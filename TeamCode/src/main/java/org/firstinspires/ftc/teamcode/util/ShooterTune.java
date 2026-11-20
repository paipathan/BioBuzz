package org.firstinspires.ftc.teamcode.util;

import static dev.nextftc.units.Units.Rotations;
import static dev.nextftc.units.Units.RotationsPerMinute;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextMotor;
import dev.nextftc.hardware.actuators.NextServo;

/**
 * Live tuner for a bang-bang + feedforward shooter controller.
 * <p>
 * power = kS + kV * setpoint            (feedforward: roughly what holds the setpoint)<br>
 *       + bang power, while rpm < setpoint - bang zone (bang-bang: push hard to catch up)<br>
 * clamped to [0, 1]. Within the bang zone (default 300 RPM) of the setpoint, feedforward alone
 * handles it, so the wheel doesn't chatter or overshoot from full-power pulses near the target.
 * Power never goes negative: above the setpoint the wheel just coasts down
 * on feedforward (motor is FLOAT), so there's no reverse-voltage braking.
 * <p>
 * Tuning: set bang power to 0 and raise kV until the wheel settles just under the setpoint,
 * then bring bang power back up so it recovers fast after a shot.
 * <p>
 * Dpad up/down: pick a value (setpoint, kS, kV, bang power, bang zone)<br>
 * Dpad right/left: raise/lower it by the current step<br>
 * Right bumper / left trigger: step x10 / /10<br>
 * Left bumper (hold): run intake, transfer, second shooter motor and open stopper to feed balls (check RPM drop)<br>
 * A: spin up / stop<br>
 * B: stop<br>
 * X: reset all values back to Constants<br>
 * Y: setpoint to 0
 * <p>
 * Final numbers get copied into Constants.Shooter by hand.
 */
@TeleOp(name = "Shooter Tune")
public class ShooterTune extends LinearOpMode {
    private static final String[] NAMES = {"Setpoint RPM", "kS", "kV", "Bang power", "Bang zone RPM"};
    private static final double[] BASE_STEPS = {100, 0.01, 0.00001, 0.05, 50};
    private static final double[] MAX = {Double.MAX_VALUE, 1, 1, 1, Double.MAX_VALUE};

    @Override
    public void runOpMode() {
        NextMotor motor = new NextMotor(RobotController.expansionHub(), Constants.Shooter.shooterMotorPort, Rotations.of(1.0 / Constants.Shooter.ticksPerRev));
        motor.setDirection(Constants.Shooter.shooterMotorDirection);
        motor.setZeroPowerBehavior(NextMotor.ZeroPowerBehavior.FLOAT);

        NextMotor intakeMotor = new NextMotor(Constants.Intake.intakeMotorName);
        intakeMotor.setDirection(NextMotor.Direction.FORWARD);
        intakeMotor.setZeroPowerBehavior(NextMotor.ZeroPowerBehavior.FLOAT);

        // Second shooter motor: full power while the flywheel runs or while feeding.
        NextMotor auxMotor = new NextMotor(RobotController.controlHub(), Constants.Shooter.shooterAuxMotorPort);
        auxMotor.setDirection(Constants.Shooter.shooterAuxMotorDirection);
        auxMotor.setZeroPowerBehavior(NextMotor.ZeroPowerBehavior.BRAKE);

        // Transfer + stopper, so balls can be fed through to measure RPM drop.
        NextMotor transferMotor = new NextMotor(RobotController.controlHub(), Constants.Transfer.transferMotorPort1);
        transferMotor.setDirection(Constants.Transfer.transferMotorDirection1);
        transferMotor.setZeroPowerBehavior(NextMotor.ZeroPowerBehavior.BRAKE);
        NextServo stopperServo = new NextServo(RobotController.controlHub(), Constants.Transfer.stopperServoPort, Constants.Transfer.stopperServoCacheTolerance, Constants.Transfer.stopperServoDirection);
        stopperServo.setPosition(Constants.Transfer.stopperClosedPosition);

        double[] values = defaults();
        double[] steps = BASE_STEPS.clone();
        int selected = 0;
        boolean running = false;

        boolean lastUp = false, lastDown = false, lastLeft = false, lastRight = false;
        boolean lastLt = false, lastRb = false, lastA = false, lastX = false;

        waitForStart();

        while (opModeIsActive()) {
            boolean up = gamepad1.dpad_up, down = gamepad1.dpad_down;
            boolean left = gamepad1.dpad_left, right = gamepad1.dpad_right;
            boolean rb = gamepad1.right_bumper, lt = gamepad1.left_trigger > 0.5;
            boolean feeding = gamepad1.left_bumper;
            boolean a = gamepad1.a, x = gamepad1.x;

            if (down && !lastDown) selected = (selected + 1) % values.length;
            if (up && !lastUp) selected = (selected - 1 + values.length) % values.length;
            if (rb && !lastRb) steps[selected] *= 10;
            if (lt && !lastLt) steps[selected] /= 10;

            if (right && !lastRight) values[selected] += steps[selected];
            if (left && !lastLeft) values[selected] -= steps[selected];
            values[selected] = Utilities.clamp(values[selected], 0, MAX[selected]);

            if (a && !lastA) running = !running;
            if (gamepad1.b) running = false;
            if (gamepad1.y) values[0] = 0;
            if (x && !lastX) {
                values = defaults();
                steps = BASE_STEPS.clone();
            }

            lastUp = up; lastDown = down; lastLeft = left; lastRight = right;
            lastLt = lt; lastRb = rb; lastA = a; lastX = x;

            double rpm = motor.getEncoderVelocity().into(RotationsPerMinute);
            double target = running ? values[0] : 0;

            double feedforward = 0, bang = 0;
            if (target > 0) {
                feedforward = values[1] + values[2] * target;
                // Only bang when well under the setpoint; inside the zone feedforward handles it.
                if (rpm < target - values[4]) bang = values[3];
            }
            // Never negative: when over speed we coast instead of braking.
            double power = Utilities.clamp(feedforward + bang, 0, 1);
            motor.setThrottle(power);
            // Hold left bumper: run the whole ball path (intake, transfer, stopper open, second motor).
            auxMotor.setThrottle(running || feeding ? 1.0 : 0.0);
            intakeMotor.setThrottle(feeding ? 1.0 : 0.0);
            transferMotor.setThrottle(feeding ? 1.0 : 0.0);
            stopperServo.setPosition(feeding ? Constants.Transfer.stopperOpenPosition : Constants.Transfer.stopperClosedPosition);
            // Outside NextOpMode nothing ticks the motors for us, so do it here.
            motor.update();
            auxMotor.update();
            intakeMotor.update();
            transferMotor.update();

            telemetry.addData("State", running ? "RUNNING" : "STOPPED");
            telemetry.addData("RPM", rpm);
            telemetry.addData("Target RPM", target);
            telemetry.addData("Error", target - rpm);
            telemetry.addData("Bang", bang > 0 ? "ON" : "off");
            telemetry.addData("Feedforward", feedforward);
            telemetry.addData("Motor power", power);
            telemetry.addData("Transfer", feeding ? "FEEDING" : "off");
            telemetry.addLine();
            for (int i = 0; i < values.length; i++) {
                telemetry.addData((i == selected ? "> " : "  ") + NAMES[i], "%.6f   (step %.6f)", values[i], steps[i]);
            }
            telemetry.addLine();
            telemetry.addLine("Dpad: select/adjust | RB: step x10 | LT: step /10 | LB (hold): feed | A: run/stop | B: stop | X: reset | Y: setpoint 0");
            telemetry.update();
        }

        motor.setThrottle(0);
        auxMotor.setThrottle(0);
        intakeMotor.setThrottle(0);
        transferMotor.setThrottle(0);
        motor.update();
        auxMotor.update();
        intakeMotor.update();
        transferMotor.update();
    }

    private static double[] defaults() {
        return new double[]{
                3000,
                Constants.Shooter.kS, Constants.Shooter.kV, Constants.Shooter.bangPower,
                Constants.Shooter.bangZoneRpm
        };
    }
}
