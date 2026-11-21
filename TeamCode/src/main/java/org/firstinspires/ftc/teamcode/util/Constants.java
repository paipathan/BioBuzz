package org.firstinspires.ftc.teamcode.util;

import com.pedropathing.algorithm.Algorithm;
import com.pedropathing.algorithm.Foresight;
import com.pedropathing.algorithm.ForesightConfig;
import com.pedropathing.controllers.Controller;
import com.pedropathing.follower.Follower;
import com.pedropathing.localization.Localizer;
import com.pedropathing.math.Matrix;
import com.pedropathing.math.Pose;
import com.pedropathing.math.Vector2D;
import com.pedropathing.revhub.drivetrains.Mecanum;
import com.pedropathing.revhub.drivetrains.MecanumConfig;
import com.pedropathing.revhub.localizers.PinpointConfig;
import com.pedropathing.revhub.localizers.PinpointLocalizer;
import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareMap;

import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;

import dev.nextftc.hardware.actuators.NextMotor;

public class Constants {
    public static com.pedropathing.drivetrain.Drivetrain drivetrain(HardwareMap h) {
        return new Mecanum(h, Drivetrain.mecanumConfig);
    }

    public static Localizer localizer(HardwareMap h) {
        return new PinpointLocalizer(h, Drivetrain.pinpointConfig);
    }

    public static Algorithm algorithm() {
        return new Foresight(Drivetrain.foresightConfig);
    }

    public static Follower create(HardwareMap h) {
        return new Follower(localizer(h), drivetrain(h), algorithm());
    }

    public static class Drivetrain {
        public static final Pose startPose = new Pose(0, 0, 0);
        // Drawn for red (degrees); Utilities.poseFactory mirrors it for blue
        // (rotated 180 deg about field center -> blue = 135.3, 72, 180).
        public static final double resetX = 8.7;
        public static final double resetY = 72;
        public static final double resetHeadingDeg = 0;

        public static final double slowSpeed = 0.4;

        // Teleop heading assist (intaking with the flower bar down). Locks the nearest multiple of
        // 90 deg if within snapWindowDeg of it, otherwise the current heading, and holds it until
        // the driver turns.
        public static class HeadingAssist {
            public static final double snapWindowDeg = 25;
            public static final double kP = 1.5;            // turn power per radian of error
            public static final double maxTurn = 0.6;
            public static final double toleranceDeg = 1;
            public static final double stickDeadband = 0.05;
        }

        public static MecanumConfig mecanumConfig = new MecanumConfig(c -> {
            c.frontLeftName.set("fl");
            c.frontRightName.set("fr");
            c.backLeftName.set("bl");
            c.backRightName.set("br");
            c.frontLeftDirection.set(DcMotorSimple.Direction.FORWARD);
            c.frontRightDirection.set(DcMotorSimple.Direction.FORWARD);
            c.backLeftDirection.set(DcMotorSimple.Direction.REVERSE);
            c.backRightDirection.set(DcMotorSimple.Direction.FORWARD);
        });
        public static final PinpointConfig pinpointConfig = new PinpointConfig(c -> {
            c.name.set("pinpoint");
            c.podType.set(GoBildaPinpointDriver.GoBildaOdometryPods.goBILDA_4_BAR_POD);
            c.xPodOffset.set(-3.489964702936608);
            c.yPodOffset.set(4.930589931217705);
            c.xPodDirection.set(GoBildaPinpointDriver.EncoderDirection.REVERSED);
            c.yPodDirection.set(GoBildaPinpointDriver.EncoderDirection.REVERSED);
            c.globalDistanceUnit.set(DistanceUnit.INCH);
            c.offsetUnits.set(DistanceUnit.INCH);
        });

        public static final ForesightConfig foresightConfig = new ForesightConfig(c -> {
            Controller primaryTranslationalForward = Controller.proportional(0.31695896638586846);
            Controller secondaryTranslationalForward = Controller.proportional(0.11710786878001524);
            Controller primaryTranslationalLateral = Controller.proportional(0.49270594302169024);
            Controller secondaryTranslationalLateral = Controller.proportional(0.1820416806012474);

            c.forwardTranslational.set(Controller.piecewise(secondaryTranslationalForward).put(2.5, primaryTranslationalForward));
            c.strafeTranslational.set(Controller.piecewise(secondaryTranslationalLateral).put(2.5, primaryTranslationalLateral));

            c.coast.set(Controller.proportionalFeedforward(0.012707253306560775));
            c.brake.set(Controller.proportionalFeedforward(0.010801165310576658));

            c.headingFeedback.set(Controller.proportional(6.100494962820854));
            c.headingBrakeCoefficients.set(Vector2D.cartesian(0.050830117376764294, 0.008351748206249005));

            c.linearBrakeCoefficients.set(Matrix.diag(0.05668663619191991, 0.06990910975077083));
            c.quadraticBrakeCoefficients.set(Matrix.diag(0.001929587469976467, 0.0013264711238913005));

            c.maxAchievableForwardVelocity.set(76.20941420165023);
            c.maxAchievableStrafeVelocity.set(62.07150168356044);
            c.naturalForwardDeceleration.set(41.12426767940491);
            c.naturalStrafeDeceleration.set(64.63576436632204);
        });
    }

    public static class Intake {
        public static final String intakeMotorName = "intake";
    }

    public static class Transfer {
        // Control Hub motor port 0
        public static final int transferMotorPort1 = 0;
        public static final NextMotor.Direction transferMotorDirection1 = NextMotor.Direction.FORWARD;

        // Control Hub servo port 5
        public static final int stopperServoPort = 5;
        public static final NextMotor.Direction stopperServoDirection = NextMotor.Direction.FORWARD;
        public static final double stopperServoCacheTolerance = 0.001;
        public static final double stopperOpenPosition = 0.2;
        public static final double stopperClosedPosition = 0.5;
        // Time for the stopper to swing open before the transfer starts feeding
        public static final long stopperOpenDelayMs = 150;
    }

    public static class FlowerBar {
        public static final int servoPort = 0;
        public static final NextMotor.Direction servoDirection = NextMotor.Direction.FORWARD;
        public static final double servoCacheTolerance = 0.001;
    }

    public static class Turret {
        public static final int turretServoPort1 = 1;
        public static final int turretServoPort2 = 2;
        public static final NextMotor.Direction turretServoDirection1 = NextMotor.Direction.REVERSE;
        public static final NextMotor.Direction turretServoDirection2 = NextMotor.Direction.REVERSE;
        public static final double servoCacheTolerance = 0.001;

        // Degrees the servo horn rotates across its full 0 -> 1 position range.
        public static final double servoRangeDegrees = 355;
        // Turret degrees per servo degree: one servo turn = 1.71 turret turns.
        public static final double servoToTurretRatio = 1.71;
        // Servo position where the turret points straight forward (turret angle 0).
        public static final double zeroPosition = 0.5;
        // Turret travel limit either side of zero (+/- 180 deg, CCW positive).
        public static final double limitDegrees = 180;
        // Flip if a positive (CCW / left) turret angle turns the turret clockwise.
        public static final boolean reversed = false;
        // How far past the +/-180 seam the goal must go before the turret swings around the other way.
        public static final double seamHysteresisDegrees = 10;
        // Turret axis relative to the robot center (drive wheelbase center), inches, robot frame:
        // +x = forward (the end opposite the intake), +y = robot left.
        // From the CAD (Drivetrain Assembly): turret bearing axis at CAD X = -1.105, Y = 0.000 with the
        // wheelbase center at the CAD origin. CAD +X points at the intake, so the turret is 1.1" forward.
        public static final Pose turretOffset = new Pose(1.1, 0);
    }

    public static class Shooter {
        // Expansion Hub motor port 0
        public static final int shooterMotorPort = 0;
        // Control Hub motor port 1. Second motor: runs full power while revving.
        public static final int shooterAuxMotorPort = 1;
        public static final NextMotor.Direction shooterAuxMotorDirection = NextMotor.Direction.REVERSE;
        public static final NextMotor.Direction shooterMotorDirection = NextMotor.Direction.REVERSE;
        public static final double ticksPerRev = 28.0;

        public static final double kS = 0.07;
        public static final double kV = 0.00017;
        public static final double kA = 0.0;

        // kA / kP / kI / kD are not used: the shooter runs bang-bang + feedforward (kS, kV, bang*).
        public static final double kP = 0.0005;
        public static final double kI = 0.0;
        public static final double kD = 0.0;

        // Bang-bang + feedforward (ShooterTune): extra power added while below the setpoint.
        public static final double bangPower = 1.0;
        // Bang only fires when more than this far below the setpoint; closer than that, feedforward alone.
        public static final double bangZoneRpm = 100.0;

        // Fixed shot speed (dpad up/down nudges it 15 RPM at a time during a match).
        public static final double shotRpm = 3005;
        // Flywheel speed while the robot is idle.
        public static final double idleRpm = 2200;
    }

    public static class Auto {
        public static final Alliance drawnAlliance = Alliance.RED;
        public static final double fieldSize = 144;

        // How early (seconds of driving) a path marker fires to make up for loop and servo delay.
        // Raise it if markers still land late, lower it if they land early.
        public static final double eventLeadSeconds = 0.25;
    }

    public static class LutTuner {
        public static final double rpmStep = 20;

        // Spots to shoot from, drawn for red (mirrored for blue), roughly every 6 in of goal distance
        // from 24 to 72 in. All sit below y = 72, so they aim at the low goal. Edit freely: saved entries
        // keep the distance the robot actually measured, so the LUT stays valid if a spot moves.
        public static final double[][] samplePoses = {
                {35.0, 60.8},  // 24 in
                {37.8, 39.6},  // 30 in
                {59.0, 24.8},  // 36 in
                {17.0, 60.8},  // 42 in
                {25.1, 26.9},  // 48 in
                {20.8, 22.6},  // 54 in
                {16.6, 18.4},  // 60 in
                {12.3, 14.1},  // 66 in
                {8.1, 9.9},    // 72 in
        };
    }

    public static class ShotCalculator {
        public static final double goalSplitY = 72;

        // false = fixed Constants.Shooter.shotRpm; true = RPM from the distance LUT below.
        public static final boolean useLut = false;

        // {goal distance (in), shooter RPM}, sorted by distance. From the LUT tuner, 2026-11-17
        // (tuning/shooter_lut.csv). Interpolated linearly; held flat outside 29-45 in.
        // Only used when useLut is true.
        public static final double[][] lut = {
                {29.17, 2990},
                {36.52, 2950},
                {45.41, 3230},
        };

        public static final Pose blueGoalLow = new Pose(85.4, 55.5);
        public static final Pose blueGoalHigh = new Pose(85.4, 82.6);
        public static final Pose redGoalLow = new Pose(59.0, 60.8);
        public static final Pose redGoalHigh = new Pose(59.0, 87.9);
    }
}
